/* Service PhéCompte : recettes anonymes (→ issues GitHub) et trouvailles de produits hypoprotéinés (→ base D1).
   Aucune donnée personnelle : pas de compte, pas d'adresse IP stockée (seulement une empreinte qui change chaque jour, pour les quotas). */
import {ALIMENTS} from "./aliments.js";
const TYPES = ["Pâtes, riz, semoule", "Pain, biscottes", "Biscuits, gâteaux", "Farines, préparations", "Desserts", "Boissons, substituts de lait", "Plats", "Autre"];
const LIMITS = {recette: 5, trouvaille: 20};
const today = () => new Date().toISOString().slice(0, 10);
const uid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);

function cors(req, env){
  const o = req.headers.get("Origin") || "", ok = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).includes(o);
  return ok ? {"Access-Control-Allow-Origin": o, "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,Authorization", "Vary": "Origin"} : {};
}
const json = (data, status, h) => new Response(JSON.stringify(data), {status: status || 200, headers: {"Content-Type": "application/json; charset=utf-8", ...h}});
const fail = (msg, status, h) => json({ok: false, error: msg}, status || 400, h);

async function ipHash(req, env){
  const ip = req.headers.get("CF-Connecting-IP") || "local";
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip + "|" + today() + "|" + (env.HASH_SALT || "phecompte")));
  return [...new Uint8Array(d)].slice(0, 12).map(b => b.toString(16).padStart(2, "0")).join("");
}
async function turnstile(token, req, env){
  if (env.TURNSTILE_BYPASS === "1") return true;                      // tests locaux uniquement
  if (!env.TURNSTILE_SECRET || !token) return false;
  const f = new FormData(); f.append("secret", env.TURNSTILE_SECRET); f.append("response", token);
  const ip = req.headers.get("CF-Connecting-IP"); if (ip) f.append("remoteip", ip);
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {method: "POST", body: f});
  const d = await r.json().catch(() => ({}));
  return d.success === true;
}
async function quota(env, h, kind){
  const day = today();
  const row = await env.DB.prepare("SELECT n FROM quotas WHERE ip_hash=? AND day=? AND kind=?").bind(h, day, kind).first();
  if (row && row.n >= LIMITS[kind]) return false;
  await env.DB.prepare("INSERT INTO quotas (ip_hash, day, kind, n) VALUES (?,?,?,1) ON CONFLICT(ip_hash, day, kind) DO UPDATE SET n = n + 1").bind(h, day, kind).run();
  return true;
}
/* validation */
const clean = (v, max) => typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f`<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
const num = (v, lo, hi) => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n * 100) / 100 : null; };

function checkFind(x){
  const e = [];
  const o = {product: clean(x.product, 80), brand: clean(x.brand, 60), type: TYPES.includes(x.type) ? x.type : "Autre", ean: /^\d{8,14}$/.test(String(x.ean || "")) ? String(x.ean) : null,
    weight_g: num(x.weight_g, 1, 20000), prot: num(x.prot, 0, 100), kcal: num(x.kcal, 0, 900), ou: x.ou === "web" ? "web" : "magasin",
    store: clean(x.store, 60), city: clean(x.city, 60), cp: /^\d{5}$/.test(String(x.cp || "")) ? String(x.cp) : null, url: null, price: num(x.price, 0, 1000), note: clean(x.note, 200)};
  if (o.product.length < 2) e.push("nom du produit");
  if (o.prot === null) e.push("protéines pour 100 g (nombre entre 0 et 100)");
  if (o.ou === "magasin"){ if (o.store.length < 2) e.push("magasin"); if (o.city.length < 2) e.push("ville"); }
  else { const u = String(x.url || "").trim(); if (/^https?:\/\/[^\s<>"]{4,300}$/i.test(u)) o.url = u; else e.push("lien du site (https://…)"); o.store = o.store || (o.url ? new URL(o.url).hostname.replace(/^www\./, "") : ""); }
  return {o, e};
}
const PUBLIC_COLS = "id, created, product, brand, type, ean, weight_g, prot, kcal, ou, store, city, cp, url, price, note, seen, gone, last_seen";

/* recette : validation et recalcul de la Phé (même méthode que l'application et scripts/recettes.py) */
const R_TYPES = ["Entrée", "Plat principal", "Dessert", "Pain"], R_LEVELS = ["Facile", "Moyen", "Difficile"];
const R_MODES = {base:"", prot:"produit emballé", phe:"Phé indiquée sur l'étiquette", zero:"sans Phé"};
const PART = 20;
const fr = (x, d) => (Math.round(x * 10 ** d) / 10 ** d).toLocaleString("fr-FR", {maximumFractionDigits:d}).replace(/\u202f|\u00a0/g, " ");
function checkRecipe(p){
  const e = [], n = clean(p.n, 80);
  if (n.length < 3) e.push("nom de la recette");
  if (!R_TYPES.includes(p.t)) e.push("type de recette");
  if (!R_LEVELS.includes(p.lv)) e.push("niveau");
  const min = num(p.min, 0, 1440); if (min === null) e.push("temps de préparation");
  const ings = Array.isArray(p.ing) ? p.ing.slice(0, 41) : [];
  if (!ings.length || ings.length > 40) e.push("ingrédients (1 à 40)");
  const steps = Array.isArray(p.et) ? p.et.map(s => clean(s, 800)).filter(Boolean) : [];
  if (!steps.length || steps.length > 30) e.push("étapes (1 à 30)");
  const det = [], ingOut = []; let total = 0;
  for (const x of ings){
    if (!x || typeof x !== "object"){ e.push("ingrédient invalide"); break; }
    let nom = clean(x.nom, 80); const g = num(x.g, 0.1, 5000), mode = x.mode; let phe = null; const o = {nom, g, mode};
    if (!nom || g === null){ e.push("ingrédient incomplet (nom et grammes)"); break; }
    if (mode === "zero") phe = 0;
    else if (mode === "base"){ const f = ALIMENTS[x.ref]; if (!f){ e.push(`aliment « ${nom} » absent de la base`); break; } nom = f[0]; o.ref = x.ref; o.nom = nom; phe = g / f[1] * PART; }
    else if (mode === "prot"){ const lait = x.lait === true, pr = num(x.prot, 0, lait ? 12 : 5); if (pr === null){ e.push(`protéines de « ${nom} »`); break; } o.prot = pr; o.lait = lait; phe = g * pr * (lait ? 50 : pr < 0.8 ? 32 : 38) / 100; }
    else if (mode === "phe"){ const v = num(x.phe100, 0, 5000); if (v === null){ e.push(`Phé de « ${nom} »`); break; } o.phe100 = v; phe = g * v / 100; }
    else { e.push("type d'ingrédient"); break; }
    total += phe; ingOut.push(o);
    det.push({txt:`${fr(g, 2)} g ${nom}` + (mode === "base" ? "" : ` (${R_MODES[mode]})`), parts:Math.round(phe / PART * 100) / 100, mode});
  }
  const kcal = p.kcal == null || p.kcal === "" ? null : num(p.kcal, 0, 50000);
  const payload = {v:1, n, t:p.t, lv:p.lv, min, p:clean(String(p.p ?? ""), 3), kcal, auteur:clean(p.auteur, 40), ing:ingOut, et:steps};
  const recette = {src:"communaute", statut:"validee", n, t:p.t, lv:p.lv, min, p:payload.p, kcal, phe:Math.round(total), parts:fr(total / PART, 1),
    ing:det.map(d => d.txt), ingDetail:det, k:[], et:steps, auteur:payload.auteur};
  return {e, payload, recette};
}


/* récapitulatif quotidien par e-mail (Brevo) : nouvelles trouvailles et recettes à valider depuis le dernier envoi */
async function buildDigest(env){
  const last = (await env.DB.prepare("SELECT v FROM meta WHERE k = 'last_digest'").first())?.v || "1970-01-01T00:00:00Z";
  const finds = (await env.DB.prepare("SELECT product, brand, ou, store, city, url, prot, kcal FROM trouvailles WHERE created > ? AND hidden = 0 ORDER BY created").bind(last).all()).results;
  const newRec = (await env.DB.prepare("SELECT n FROM recettes WHERE created > ? ORDER BY created").bind(last).all()).results;
  const pending = (await env.DB.prepare("SELECT COUNT(*) AS c FROM recettes WHERE statut = 'attente'").first()).c;
  const e = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const where = f => f.ou === "web" ? (f.url || "web") : `${f.store}, ${f.city}`;
  const subject = `PhéCompte : ${finds.length} nouvelle${finds.length > 1 ? "s" : ""} trouvaille${finds.length > 1 ? "s" : ""}, ${pending} recette${pending > 1 ? "s" : ""} à valider`;
  const text = [subject, "", finds.length ? "Nouvelles trouvailles :" : "", ...finds.map(f => `- ${f.product}${f.brand ? " (" + f.brand + ")" : ""} : ${where(f)}`),
    newRec.length ? "\nNouvelles recettes proposées :" : "", ...newRec.map(r => `- ${r.n}`), `\nRecettes en attente de validation : ${pending}`, `Modération : ${env.ADMIN_URL}`, `Application : ${env.SITE_URL}`].filter(s => s !== "").join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#12232e;max-width:560px">
    <h2 style="font-size:18px">PhéCompte : récapitulatif du jour</h2>
    ${finds.length ? `<p><b>${finds.length} nouvelle${finds.length > 1 ? "s" : ""} trouvaille${finds.length > 1 ? "s" : ""}</b></p><ul>${finds.map(f => `<li>${e(f.product)}${f.brand ? " (" + e(f.brand) + ")" : ""} : ${e(where(f))} <span style="color:#667">· ${e(f.prot)} g de protéines/100 g</span></li>`).join("")}</ul>` : ""}
    ${newRec.length ? `<p><b>${newRec.length} nouvelle${newRec.length > 1 ? "s" : ""} recette${newRec.length > 1 ? "s" : ""} proposée${newRec.length > 1 ? "s" : ""}</b></p><ul>${newRec.map(r => `<li>${e(r.n)}</li>`).join("")}</ul>` : ""}
    <p>Recettes en attente de validation : <b>${pending}</b></p>
    <p><a href="${e(env.ADMIN_URL)}" style="background:#0d7a70;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Ouvrir la modération</a></p>
    <p style="color:#667;font-size:13px">E-mail automatique envoyé seulement les jours avec du nouveau.</p></div>`;
  return {nouveau: finds.length + newRec.length, subject, text, html};
}
async function sendDigest(env, force){
  const d = await buildDigest(env);
  if (!d.nouveau && !force) return {envoye: false, raison: "rien de nouveau"};
  const to = String(env.NOTIFY_EMAILS || "").split(",").map(s => s.trim()).filter(s => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
  if (!env.BREVO_API_KEY || !env.NOTIFY_FROM || !to.length) return {envoye: false, raison: "e-mail non configuré (BREVO_API_KEY, NOTIFY_FROM, NOTIFY_EMAILS)", apercu: d.text};
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {method: "POST", headers: {"api-key": env.BREVO_API_KEY, "Content-Type": "application/json", "Accept": "application/json"},
    body: JSON.stringify({sender: {name: "PhéCompte", email: env.NOTIFY_FROM}, to: to.map(email => ({email})), subject: d.subject, htmlContent: d.html, textContent: d.text})});
  if (!r.ok) return {envoye: false, raison: "Brevo a refusé l'envoi (" + r.status + ") : " + (await r.text()).slice(0, 200)};
  await env.DB.prepare("INSERT INTO meta (k, v) VALUES ('last_digest', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(new Date().toISOString()).run();
  return {envoye: true, destinataires: to.length, sujet: d.subject};
}
const parisHour = () => +new Intl.DateTimeFormat("fr-FR", {timeZone: "Europe/Paris", hour: "numeric", hourCycle: "h23"}).format(new Date());

export default {
  async scheduled(event, env, ctx){
    if (parisHour() !== 21) return;                      // 21 h à Paris, quelle que soit la saison
    ctx.waitUntil(sendDigest(env, false));
  },
  async fetch(req, env){
    const url = new URL(req.url), path = url.pathname.replace(/\/+$/, "") || "/", h = cors(req, env);
    if (req.method === "OPTIONS") return new Response(null, {status: 204, headers: h});
    try {
      if (path === "/" || path === "/sante") return json({ok: true, service: "phecompte-api"}, 200, h);

      if (path === "/trouvailles" && req.method === "GET"){
        const r = await env.DB.prepare(`SELECT ${PUBLIC_COLS} FROM trouvailles WHERE hidden = 0 ORDER BY last_seen DESC LIMIT 1000`).all();
        return json({ok: true, trouvailles: r.results}, 200, {...h, "Cache-Control": "public, max-age=60"});
      }
      if (path === "/trouvailles" && req.method === "POST"){
        const d = await req.json().catch(() => null); if (!d || typeof d.item !== "object") return fail("Requête invalide.", 400, h);
        if (!(await turnstile(d.token, req, env))) return fail("Vérification anti-robot échouée : réessayez.", 403, h);
        const {o, e} = checkFind(d.item); if (e.length) return fail("À compléter : " + e.join(", ") + ".", 422, h);
        const ih = await ipHash(req, env); if (!(await quota(env, ih, "trouvaille"))) return fail("Limite de signalements atteinte pour aujourd'hui.", 429, h);
        const id = uid(), now = new Date().toISOString();
        await env.DB.prepare(`INSERT INTO trouvailles (id, created, product, brand, type, ean, weight_g, prot, kcal, ou, store, city, cp, url, price, note, seen, gone, last_seen, hidden, ip_hash)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0,?,0,?)`).bind(id, now, o.product, o.brand, o.type, o.ean, o.weight_g, o.prot, o.kcal, o.ou, o.store, o.city, o.cp, o.url, o.price, o.note, now, ih).run();
        await env.DB.prepare("INSERT OR IGNORE INTO avis (find_id, ip_hash, day, kind) VALUES (?,?,?,'vu')").bind(id, ih, today()).run();
        return json({ok: true, id}, 201, h);
      }
      let m = path.match(/^\/trouvailles\/([a-f0-9]{12})\/avis$/);
      if (m && req.method === "POST"){
        const d = await req.json().catch(() => ({})), kind = d.kind === "absent" ? "absent" : "vu", ih = await ipHash(req, env);
        const ex = await env.DB.prepare("SELECT id FROM trouvailles WHERE id = ? AND hidden = 0").bind(m[1]).first(); if (!ex) return fail("Trouvaille introuvable.", 404, h);
        const ins = await env.DB.prepare("INSERT OR IGNORE INTO avis (find_id, ip_hash, day, kind) VALUES (?,?,?,?)").bind(m[1], ih, today(), kind).run();
        if (!ins.meta.changes) return json({ok: true, deja: true}, 200, h);
        await env.DB.prepare(kind === "vu" ? "UPDATE trouvailles SET seen = seen + 1, last_seen = ? WHERE id = ?" : "UPDATE trouvailles SET gone = gone + 1 WHERE id = ?")
          .bind(...(kind === "vu" ? [new Date().toISOString(), m[1]] : [m[1]])).run();
        return json({ok: true}, 200, h);
      }
      if (path === "/recettes" && req.method === "GET"){
        const r = await env.DB.prepare("SELECT id, created, moderated, recette FROM recettes WHERE statut = 'validee' ORDER BY moderated DESC LIMIT 500").all();
        const list = r.results.map(x => ({...JSON.parse(x.recette), id:"cf-" + x.id, date:(x.moderated || x.created).slice(0, 10)}));
        return json({ok: true, recettes: list}, 200, {...h, "Cache-Control": "public, max-age=60"});
      }
      if (path === "/recettes" && req.method === "POST"){
        const d = await req.json().catch(() => null), p = d && d.recette;
        if (!p || typeof p !== "object" || JSON.stringify(p).length > 30000) return fail("Recette invalide.", 400, h);
        const {e, payload, recette} = checkRecipe(p); if (e.length) return fail("À corriger : " + e.join(", ") + ".", 422, h);
        if (!(await turnstile(d.token, req, env))) return fail("Vérification anti-robot échouée : réessayez.", 403, h);
        const ih = await ipHash(req, env); if (!(await quota(env, ih, "recette"))) return fail("Limite d'envois atteinte pour aujourd'hui.", 429, h);
        const id = uid();
        await env.DB.prepare("INSERT INTO recettes (id, created, statut, n, recette, payload, ip_hash) VALUES (?,?,'attente',?,?,?,?)")
          .bind(id, new Date().toISOString(), payload.n, JSON.stringify(recette), JSON.stringify(payload), ih).run();
        return json({ok: true, id, parts: recette.parts}, 201, h);
      }

      /* modération : page /admin + API protégée par ADMIN_TOKEN */
      if (path === "/admin" && req.method === "GET") return new Response(ADMIN_HTML, {headers: {"Content-Type": "text/html; charset=utf-8"}});
      if (path.startsWith("/admin/")){
        if (!env.ADMIN_TOKEN || req.headers.get("Authorization") !== "Bearer " + env.ADMIN_TOKEN) return fail("Accès refusé.", 401);
        if (path === "/admin/trouvailles" && req.method === "GET"){
          const r = await env.DB.prepare(`SELECT ${PUBLIC_COLS}, hidden FROM trouvailles ORDER BY created DESC LIMIT 2000`).all();
          return json({ok: true, trouvailles: r.results});
        }
        if (path === "/admin/recettes" && req.method === "GET"){
          const r = await env.DB.prepare("SELECT id, created, statut, moderated, recette FROM recettes ORDER BY CASE statut WHEN 'attente' THEN 0 WHEN 'validee' THEN 1 ELSE 2 END, created DESC LIMIT 1000").all();
          return json({ok: true, recettes: r.results.map(x => ({id:x.id, created:x.created, statut:x.statut, moderated:x.moderated, ...JSON.parse(x.recette), statutRecette:x.statut}))});
        }
        if (path === "/admin/recapitulatif" && req.method === "POST") return json({ok: true, ...(await sendDigest(env, true))});
        const mr = path.match(/^\/admin\/recettes\/([a-f0-9]{12})$/);
        if (mr && req.method === "POST"){
          const d = await req.json().catch(() => ({})), now = new Date().toISOString();
          if (d.action === "supprimer") await env.DB.prepare("DELETE FROM recettes WHERE id = ?").bind(mr[1]).run();
          else { const st = {valider:"validee", refuser:"refusee", attente:"attente"}[d.action]; if (!st) return fail("Action inconnue.");
            await env.DB.prepare("UPDATE recettes SET statut = ?, moderated = ? WHERE id = ?").bind(st, now, mr[1]).run(); }
          return json({ok: true});
        }
        m = path.match(/^\/admin\/trouvailles\/([a-f0-9]{12})$/);
        if (m && req.method === "POST"){
          const d = await req.json().catch(() => ({}));
          if (d.action === "supprimer"){ await env.DB.prepare("DELETE FROM trouvailles WHERE id = ?").bind(m[1]).run(); await env.DB.prepare("DELETE FROM avis WHERE find_id = ?").bind(m[1]).run(); }
          else await env.DB.prepare("UPDATE trouvailles SET hidden = ? WHERE id = ?").bind(d.action === "masquer" ? 1 : 0, m[1]).run();
          return json({ok: true});
        }
      }
      return fail("Introuvable.", 404, h);
    } catch (err){
      return fail("Erreur du service.", 500, h);
    }
  }
};

const ADMIN_HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Modération PhéCompte</title><style>body{font:15px system-ui,sans-serif;margin:0 auto;padding:16px;max-width:1000px;color:#12232e}input,button{font:inherit;padding:8px 10px;border:1px solid #ccd;border-radius:8px}button{cursor:pointer;background:#fff}
.tabs{display:flex;gap:8px;margin:14px 0}.tabs button[aria-pressed=true]{background:#12232e;color:#fff}table{width:100%;border-collapse:collapse}td,th{border-top:1px solid #dde;padding:8px;text-align:left;vertical-align:top;font-size:14px}tr.h{opacity:.45}.m{color:#667}
.r{border:1px solid #dde;border-radius:12px;padding:12px;margin:10px 0}.r.validee{border-color:#2b9a57}.r.refusee{opacity:.55}.b{display:inline-block;font-size:12px;font-weight:700;padding:2px 8px;border-radius:99px;background:#eef}.attente .b{background:#fde9c8}.validee .b{background:#d2f0dc}
ul,ol{margin:6px 0;padding-left:20px}.act{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}</style></head><body>
<h1>Modération PhéCompte</h1><p class="m">Saisissez le mot de passe de modération (secret ADMIN_TOKEN). Il reste dans cet onglet uniquement.</p>
<form id="f"><input type="password" id="t" placeholder="Mot de passe" autocomplete="off"> <button>Afficher</button></form>
<div class="tabs" id="tabs" hidden><button data-v="recettes" aria-pressed="true">Recettes</button><button data-v="trouvailles" aria-pressed="false">Trouvailles</button><button id="dg" type="button" style="margin-left:auto">Envoyer le récapitulatif maintenant</button></div><p id="dgm" class="m"></p><div id="o"></div>
<script>
let T="",V="recettes";const o=document.getElementById("o");const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const H=()=>({Authorization:"Bearer "+T,"Content-Type":"application/json"});
async function load(){const r=await fetch("/admin/"+V,{headers:H()});if(!r.ok){o.textContent="Mot de passe incorrect.";return;}document.getElementById("tabs").hidden=false;const d=await r.json();
if(V==="trouvailles"){if(!d.trouvailles.length){o.innerHTML="<p>Aucune trouvaille pour l'instant.</p>";return;}
o.innerHTML="<table><tr><th>Produit</th><th>Où</th><th>Valeurs</th><th>Avis</th><th></th></tr>"+d.trouvailles.map(x=>"<tr class='"+(x.hidden?"h":"")+"'><td><b>"+esc(x.product)+"</b><br><span class=m>"+esc(x.brand)+" · "+esc(x.type)+"<br>"+esc(x.created.slice(0,10))+"</span></td><td>"+esc(x.ou==="web"?x.url:x.store+", "+x.city)+"</td><td>"+esc(x.prot)+" g prot. · "+esc(x.kcal??"?")+" kcal /100 g</td><td>vu "+x.seen+" · absent "+x.gone+"</td><td><button data-k='trouvailles' data-a='"+(x.hidden?"afficher":"masquer")+"' data-i='"+x.id+"'>"+(x.hidden?"Réafficher":"Masquer")+"</button> <button data-k='trouvailles' data-a='supprimer' data-i='"+x.id+"'>Supprimer</button></td></tr>").join("")+"</table>";return;}
if(!d.recettes.length){o.innerHTML="<p>Aucune recette proposée pour l'instant.</p>";return;}
const L={attente:"En attente",validee:"Validée",refusee:"Refusée"};
o.innerHTML=d.recettes.map(x=>"<div class='r "+x.statutRecette+"'><span class=b>"+L[x.statutRecette]+"</span> <b>"+esc(x.n)+"</b> <span class=m>"+esc(x.t)+" · "+esc(x.lv)+" · "+esc(x.min)+" min"+(x.p?" · "+esc(x.p)+" pers.":"")+" · envoyée le "+esc(x.created.slice(0,10))+(x.auteur?" par "+esc(x.auteur):"")+"</span>"+
"<div><b>"+esc(x.parts)+" parts</b> ("+esc(x.phe)+" mg de Phé, recalculé par le service)"+(x.kcal?" · "+esc(x.kcal)+" kcal":"")+"</div><ul>"+x.ingDetail.map(i=>"<li>"+esc(i.txt)+" <span class=m>("+esc(i.parts)+" part)</span></li>").join("")+"</ul><ol>"+x.et.map(s=>"<li>"+esc(s)+"</li>").join("")+"</ol>"+
"<div class=act>"+(x.statutRecette!=="validee"?"<button data-k='recettes' data-a='valider' data-i='"+x.id+"'>Valider</button>":"<button data-k='recettes' data-a='attente' data-i='"+x.id+"'>Remettre en attente</button>")+(x.statutRecette!=="refusee"?"<button data-k='recettes' data-a='refuser' data-i='"+x.id+"'>Refuser</button>":"")+"<button data-k='recettes' data-a='supprimer' data-i='"+x.id+"'>Supprimer</button></div></div>").join("");}
document.getElementById("f").onsubmit=e=>{e.preventDefault();T=document.getElementById("t").value;load();};
document.getElementById("tabs").onclick=e=>{const b=e.target.closest("button");if(!b)return;if(b.id==="dg"){document.getElementById("dgm").textContent="Envoi…";fetch("/admin/recapitulatif",{method:"POST",headers:H()}).then(r=>r.json()).then(d=>{document.getElementById("dgm").textContent=d.envoye?"Récapitulatif envoyé à "+d.destinataires+" destinataire(s).":"Non envoyé : "+d.raison;});return;}V=b.dataset.v;document.querySelectorAll("#tabs button").forEach(x=>x.setAttribute("aria-pressed",x===b));load();};
o.onclick=async e=>{const b=e.target.closest("button");if(!b)return;if(b.dataset.a==="supprimer"&&!b.dataset.ok){b.dataset.ok=1;b.textContent="Confirmer";return;}
await fetch("/admin/"+b.dataset.k+"/"+b.dataset.i,{method:"POST",headers:H(),body:JSON.stringify({action:b.dataset.a})});load();};
</script></body></html>`;
