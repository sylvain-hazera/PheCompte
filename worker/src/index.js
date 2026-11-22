/* Service PhéCompte : recettes anonymes (→ issues GitHub) et trouvailles de produits hypoprotéinés (→ base D1).
   Aucune donnée personnelle : pas de compte, pas d'adresse IP stockée (seulement une empreinte qui change chaque jour, pour les quotas). */
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

/* recette → issue GitHub (même format que l'application ; la Phé est recalculée par scripts/recettes.py) */
function recipeIssue(p){
  const n = clean(p.n, 80);
  const body = `<!-- phecompte-recette v1 -->
### ${n}

Recette proposée anonymement depuis l'application.

#### Ingrédients
${(p.ing || []).slice(0, 40).map(x => `- ${num(x.g, 0, 5000) ?? "?"} g ${clean(x.nom, 80)}`).join("\n")}

#### Préparation
${(p.et || []).slice(0, 30).map((s, i) => `${i + 1}. ${clean(s, 800)}`).join("\n")}

<details><summary>Données pour l'application (ne pas modifier)</summary>

\`\`\`json
${JSON.stringify(p, null, 1).replace(/`/g, "'")}
\`\`\`
</details>`;
  return {title: "[Recette] " + n, body};
}

export default {
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
      if (path === "/recettes" && req.method === "POST"){
        const d = await req.json().catch(() => null), p = d && d.recette;
        if (!p || typeof p !== "object" || JSON.stringify(p).length > 30000) return fail("Recette invalide.", 400, h);
        if (clean(p.n, 80).length < 3 || !Array.isArray(p.ing) || !p.ing.length || !Array.isArray(p.et) || !p.et.length) return fail("Recette incomplète.", 422, h);
        if (!(await turnstile(d.token, req, env))) return fail("Vérification anti-robot échouée : réessayez.", 403, h);
        if (!env.ISSUES_TOKEN) return fail("Envoi des recettes non configuré.", 503, h);
        const ih = await ipHash(req, env); if (!(await quota(env, ih, "recette"))) return fail("Limite d'envois atteinte pour aujourd'hui.", 429, h);
        p.auteur = clean(p.auteur, 40);
        const {title, body} = recipeIssue(p);
        const r = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/issues`, {method: "POST",
          headers: {"Authorization": "Bearer " + env.ISSUES_TOKEN, "Accept": "application/vnd.github+json", "User-Agent": "phecompte-api", "Content-Type": "application/json"},
          body: JSON.stringify({title, body})});
        if (!r.ok) return fail("GitHub n'a pas accepté la recette (" + r.status + ").", 502, h);
        const is = await r.json();
        return json({ok: true, numero: is.number, url: is.html_url}, 201, h);
      }

      /* modération : page /admin + API protégée par ADMIN_TOKEN */
      if (path === "/admin" && req.method === "GET") return new Response(ADMIN_HTML, {headers: {"Content-Type": "text/html; charset=utf-8"}});
      if (path.startsWith("/admin/")){
        if (!env.ADMIN_TOKEN || req.headers.get("Authorization") !== "Bearer " + env.ADMIN_TOKEN) return fail("Accès refusé.", 401);
        if (path === "/admin/trouvailles" && req.method === "GET"){
          const r = await env.DB.prepare(`SELECT ${PUBLIC_COLS}, hidden FROM trouvailles ORDER BY created DESC LIMIT 2000`).all();
          return json({ok: true, trouvailles: r.results});
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
<title>Modération PhéCompte</title><style>body{font:15px system-ui,sans-serif;margin:0;padding:16px;max-width:1000px;margin:auto;color:#12232e}input,button{font:inherit;padding:8px 10px;border:1px solid #ccd;border-radius:8px}button{cursor:pointer;background:#fff}
table{width:100%;border-collapse:collapse;margin-top:12px}td,th{border-top:1px solid #dde;padding:8px;text-align:left;vertical-align:top;font-size:14px}tr.h{opacity:.45}.m{color:#667}</style></head><body>
<h1>Modération des trouvailles</h1><p class="m">Saisissez le mot de passe de modération (secret ADMIN_TOKEN). Il reste dans cet onglet uniquement.</p>
<form id="f"><input type="password" id="t" placeholder="Mot de passe" autocomplete="off"> <button>Afficher</button></form><div id="o"></div>
<script>
let T="";const o=document.getElementById("o");const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
async function load(){const r=await fetch("/admin/trouvailles",{headers:{Authorization:"Bearer "+T}});if(!r.ok){o.textContent="Mot de passe incorrect.";return;}const d=await r.json();
o.innerHTML="<table><tr><th>Produit</th><th>Où</th><th>Valeurs</th><th>Avis</th><th></th></tr>"+d.trouvailles.map(x=>"<tr class='"+(x.hidden?"h":"")+"'><td><b>"+esc(x.product)+"</b><br><span class=m>"+esc(x.brand)+" · "+esc(x.type)+"<br>"+esc(x.created.slice(0,10))+"</span></td><td>"+esc(x.ou==="web"?x.url:x.store+", "+x.city)+"</td><td>"+esc(x.prot)+" g prot. · "+esc(x.kcal??"?")+" kcal /100 g</td><td>vu "+x.seen+" · absent "+x.gone+"</td><td><button data-a='"+(x.hidden?"afficher":"masquer")+"' data-i='"+x.id+"'>"+(x.hidden?"Réafficher":"Masquer")+"</button> <button data-a='supprimer' data-i='"+x.id+"'>Supprimer</button></td></tr>").join("")+"</table>";}
document.getElementById("f").onsubmit=e=>{e.preventDefault();T=document.getElementById("t").value;load();};
o.onclick=async e=>{const b=e.target.closest("button");if(!b)return;if(b.dataset.a==="supprimer"&&!b.dataset.ok){b.dataset.ok=1;b.textContent="Confirmer";return;}
await fetch("/admin/trouvailles/"+b.dataset.i,{method:"POST",headers:{Authorization:"Bearer "+T,"Content-Type":"application/json"},body:JSON.stringify({action:b.dataset.a})});load();};
</script></body></html>`;
