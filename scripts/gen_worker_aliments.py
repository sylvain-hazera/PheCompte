"""Génère worker/src/aliments.js (nom et poids pour 1 part de chaque aliment) à partir de src/data.js,
pour que le service recalcule la Phé des recettes exactement comme l'application."""
import json, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
t = (root / "src/data.js").read_text(encoding="utf-8")
a = json.loads(t[t.index("["):t.index("];") + 1])
m = {"a%d" % r[0]: [r[1], r[2]] for r in a}
(root / "worker/src/aliments.js").write_text("// Fichier généré par scripts/gen_worker_aliments.py — ne pas modifier\nexport const ALIMENTS = " + json.dumps(m, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
print(len(m), "aliments")
