# PhéCompte

Web-app installable (PWA) d'aide au régime de la phénylcétonurie : calcul des parts de phénylalanine, suivi du taux sanguin, recettes, convertisseur mg/dL ⇄ µmol/L.

- `index.html` : l'application (fonctionne hors connexion une fois installée, données stockées uniquement sur l'appareil).
- Journal des repas par date, note du jour (malade, fatigué…), journée type remise automatiquement, calendrier de suivi, rapport PDF jusqu'à 6 mois (jsPDF, dans `vendor/`).
- `aliments.html` : la base d'aliments, les formules et les recettes, avec un outil de relecture pour les diététicien(ne)s.

## Construire

```
python3 build.py   # produit dist/
```

Le dossier `dist/` est publié automatiquement sur GitHub Pages à chaque push sur `main`.

## Données

La table des aliments, les formules des produits emballés et les recettes proviennent de l'application aPhetit (Merck Serono / BioMarin, 2015-2017), élaborée avec la SFEIM et l'association Les Feux Follets. Usage personnel ; à faire valider par l'équipe médicale.

## Recettes de la communauté

Proposées depuis l'application sous forme d'issue GitHub. La Phé est recalculée par `scripts/recettes.py`. **Une recette n'est publiée qu'après ajout de l'étiquette « validée »** (par une diététicienne ou le mainteneur) ; retirer l'étiquette ou fermer l'issue la retire. Une modification de la recette retire automatiquement la validation.

**Outil indicatif : ne remplace pas l'avis de l'équipe médicale.**

## Licence

© 2025-2026 Sylvain Hazera, tous droits réservés. Usage personnel de l'application publiée autorisé ; copie, modification et redistribution interdites sans accord écrit. Les données de tiers (SFEIM, Ciqual, aPhetit) et les bibliothèques du dossier `vendor/` gardent leurs propres conditions. Voir [LICENSE](LICENSE).
