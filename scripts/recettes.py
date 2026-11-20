"""Construit data/recettes-communaute.json à partir des issues GitHub ouvertes.

Usage : python3 scripts/recettes.py issues.json [numero_issue_declencheur]
Le contenu des issues est non fiable : tout est validé, borné et recalculé ici.
La Phé est recalculée avec la même méthode que l'application (src/app.html, ingPhe).
"""
import json, re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
MARK = "<!-- phecompte-recette v1 -->"
TYPES = {"Entrée", "Plat principal", "Dessert", "Pain"}
LEVELS = {"Facile", "Moyen", "Difficile"}
MODES = {"base": "fruit ou légume de la base", "prot": "produit emballé", "phe": "Phé indiquée sur l'étiquette", "zero": "sans Phé"}
PART = 20


def load_foods():
    t = (ROOT / "src/data.js").read_text(encoding="utf-8")
    a = t[t.index("["):t.index("];") + 1]
    return {"a%d" % r[0]: {"n": r[1], "w": r[2]} for r in json.loads(a)}


FOODS = load_foods()


def txt(v, mx, mn=0):
    if not isinstance(v, str):
        raise ValueError("texte attendu")
    v = re.sub(r"[\x00-\x1f\x7f]", " ", v).strip()
    if len(v) < mn or len(v) > mx:
        raise ValueError("longueur de texte invalide (%d à %d caractères)" % (mn, mx))
    return v


def num(v, lo, hi):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not (lo <= v <= hi):
        raise ValueError("nombre hors limites (%s à %s)" % (lo, hi))
    return float(v)


def fr(x, d=2):
    s = ("%." + str(d) + "f") % x
    s = s.rstrip("0").rstrip(".") if "." in s else s
    return s.replace(".", ",")


def parse(issue):
    body = issue.get("body") or ""
    if MARK not in body:
        return None
    blocks = re.findall(r"```json\s*\n(.*?)\n```", body, re.S)
    if not blocks:
        raise ValueError("bloc de données JSON introuvable")
    d = json.loads(blocks[-1])
    if not isinstance(d, dict):
        raise ValueError("données invalides")
    n = txt(d.get("n"), 80, 3)
    t = d.get("t")
    lv = d.get("lv")
    if t not in TYPES:
        raise ValueError("type de recette inconnu")
    if lv not in LEVELS:
        raise ValueError("niveau inconnu")
    mn = int(num(d.get("min"), 0, 1440))
    p = txt(str(d.get("p") or ""), 3)
    kcal = d.get("kcal")
    kcal = int(num(kcal, 0, 50000)) if kcal not in (None, "") else None
    auteur = txt(d.get("auteur") or "", 40)
    ings = d.get("ing")
    if not isinstance(ings, list) or not 1 <= len(ings) <= 40:
        raise ValueError("de 1 à 40 ingrédients attendus")
    det, total = [], 0.0
    for x in ings:
        if not isinstance(x, dict):
            raise ValueError("ingrédient invalide")
        nom = txt(x.get("nom"), 80, 1)
        g = num(x.get("g"), 0.1, 5000)
        mode = x.get("mode")
        if mode == "zero":
            phe = 0.0
        elif mode == "base":
            f = FOODS.get(x.get("ref"))
            if not f:
                raise ValueError("aliment « %s » absent de la base" % nom)
            nom = f["n"]
            phe = g / f["w"] * PART
        elif mode == "prot":
            lait = x.get("lait") is True
            pr = num(x.get("prot"), 0, 12 if lait else 5)
            phe = g * pr * (50 if lait else (32 if pr < 0.8 else 38)) / 100
        elif mode == "phe":
            phe = g * num(x.get("phe100"), 0, 5000) / 100
        else:
            raise ValueError("type d'ingrédient inconnu")
        total += phe
        det.append({"txt": "%s g %s" % (fr(g), nom) + ("" if mode == "base" else " (%s)" % MODES[mode]),
                    "parts": round(phe / PART, 2), "mode": mode})
    steps = d.get("et")
    if not isinstance(steps, list) or not 1 <= len(steps) <= 30:
        raise ValueError("de 1 à 30 étapes attendues")
    steps = [txt(s, 800, 1) for s in steps]
    labels = {l.get("name") for l in issue.get("labels") or []}
    login = (issue.get("author") or {}).get("login") or ""
    return {
        "id": "i%d" % issue["number"], "src": "communaute", "statut": "validee" if "validée" in labels else "non_verifiee",
        "n": n, "t": t, "lv": lv, "min": mn, "p": p, "kcal": kcal,
        "phe": round(total), "parts": fr(round(total / PART, 1), 1),
        "ing": [x["txt"] for x in det], "ingDetail": det, "k": [], "et": steps,
        "auteur": auteur or login, "date": (issue.get("createdAt") or "")[:10], "url": issue.get("url") or "",
    }


def main():
    issues = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
    trigger = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2].isdigit() else None
    out, result = [], "none"
    for issue in sorted(issues, key=lambda i: i["number"]):
        try:
            r = parse(issue)
            if r:
                out.append(r)
                if issue["number"] == trigger:
                    result = "ok"
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as e:
            if issue["number"] == trigger:
                result = "error: %s" % e
    (ROOT / "data/recettes-communaute.json").write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    pathlib.Path("/tmp/recette-result.txt").write_text(result, encoding="utf-8")
    print("%d recette(s) publiée(s) ; issue déclencheuse : %s" % (len(out), result))


if __name__ == "__main__":
    main()
