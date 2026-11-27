import pathlib,shutil,sys
root=pathlib.Path(__file__).parent; data=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else root/'src/data.js').read_text(encoding='utf-8')
import json
_h=json.loads((root/'data/hypo-catalogue.json').read_text(encoding='utf-8'))
_k=json.loads((root/'data/kcal-fruits-legumes.json').read_text(encoding='utf-8'))
_sf=json.loads((root/'data/parts-sfeim.json').read_text(encoding='utf-8'))
_lys=next(s['aliments'] for s in _sf['systemes'] if s['id']=='lys')
data=data.rstrip()+'\nconst LYS='+json.dumps(_lys,ensure_ascii=False,separators=(',',':'))+';\nconst KCAL_FL='+json.dumps(_k['aliments'],ensure_ascii=False,separators=(',',':'))+';\nconst KCAL_FL_SRC='+json.dumps(_k['source'],ensure_ascii=False)+';\nconst HYPO='+json.dumps(_h['produits'],ensure_ascii=False,separators=(',',':'))+';\nconst HYPO_NOTE='+json.dumps(_h['note'],ensure_ascii=False)+';\n'
app=(root/'src/app.html').read_text(encoding='utf-8').replace('/*DATA*/',data)
out=root/'dist'; out.mkdir(exist_ok=True); (out/'icons').mkdir(exist_ok=True)
(root/'artifact.html').write_text(app,encoding='utf-8')
head='''<!doctype html>
<html lang="fr"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0d7a70">
<meta name="description" content="Calcul des parts de phénylalanine, suivi sanguin et recettes pour la phénylcétonurie.">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="PhéCompte">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon-192.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
'''
sw='\n<script>if("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js");</script>\n'
(out/'index.html').write_text(head+app.replace('<div class="shell">','</head><body>\n<div class="shell">',1)+sw+'</body></html>\n',encoding='utf-8')
for f in ['manifest.webmanifest','sw.js']: shutil.copy(root/'src'/f,out/f)
for f in (root/'icons').glob('*.png'): shutil.copy(f,out/'icons'/f.name)
_s=json.loads((root/'data/parts-sfeim.json').read_text(encoding='utf-8'))
(out/'aliments.html').write_text((root/'src/aliments.html').read_text(encoding='utf-8').replace('/*DATA*/',data+'const SFEIM='+json.dumps(_s,ensure_ascii=False,separators=(',',':'))+';\n'),encoding='utf-8')
shutil.copy(out/'aliments.html',root/'aliments.html')
c=root/'data/recettes-communaute.json'
(out/'recettes-communaute.json').write_text(c.read_text(encoding='utf-8') if c.exists() else '[]\n',encoding='utf-8')
shutil.copytree(root/'vendor',out/'vendor',dirs_exist_ok=True)
shutil.copy(root/'src/confidentialite.html',out/'confidentialite.html')
shutil.copy(root/'src/guide.html',out/'guide.html')
shutil.copytree(root/'src/guide',out/'guide',dirs_exist_ok=True)
print('ok')
