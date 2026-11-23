"""Génère src/guide.html à partir de l'export Word du guide d'utilisation (Claude Docs).
Usage : python3 scripts/guide.py chemin/vers/guide.docx
Les captures sont enregistrées dans src/guide/imgN.webp (1200 px de large)."""
import io, re, sys, pathlib, zipfile
import mammoth
from PIL import Image
root = pathlib.Path(__file__).resolve().parent.parent
src = pathlib.Path(sys.argv[1]).read_bytes()
out = root / "src/guide"; out.mkdir(exist_ok=True)
for f in out.glob("img*.webp"): f.unlink()
n = [0]
def img(image):
    n[0] += 1
    with image.open() as fh: im = Image.open(io.BytesIO(fh.read())).convert("RGB")
    w, h = im.size
    if w > 1200: im = im.resize((1200, round(h * 1200 / w)), Image.LANCZOS)
    im.save(out / f"img{n[0]}.webp", "WEBP", quality=82, method=6)
    return {"src": f"guide/img{n[0]}.webp", "loading": "lazy", "width": str(im.size[0]), "height": str(im.size[1])}
body = mammoth.convert_to_html(io.BytesIO(src), convert_image=mammoth.images.img_element(img)).value
body = re.sub(r"<(t[hd])><p>(.*?)</p></\1>", r"<\1>\2</\1>", body)
title = re.search(r"<h1>(.*?)</h1>", body).group(1)
body = re.sub(r"<h1>.*?</h1>\s*<p>[^<]*·[^<]*</p>", "", body, count=1)   # titre et ligne date · auteur
body = body.replace("<table>", '<div class="scroll"><table>').replace("</table>", "</table></div>")
body = body.replace("<li>☐ ", '<li class="todo">').replace("<li>☐", '<li class="todo">')
tpl = (root / "src/guide.tpl.html").read_text(encoding="utf-8")
(root / "src/guide.html").write_text(tpl.replace("{{TITLE}}", title).replace("{{BODY}}", body), encoding="utf-8")
print(n[0], "images ;", len(body), "caractères")
