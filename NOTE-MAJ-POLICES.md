# Mise à jour « Polices agrandies » (24/09/2026)

## Demande
Dans le rapport généré (PDF et Word), les polices étaient un peu petites :
toutes les tailles ont été **augmentées d'au moins 2 pt**, avec des polices
conformes à la **charte graphique BFR Systems** (site bfrsystems.com).

## Polices retenues
- **Titres, bandeaux de section, sous-titres** : **Poppins** (semi-géométrique,
  celle des titres du site BFR et du logo).
- **Corps de texte** : **Open Sans** (texte courant du site BFR).
- **PDF** : le moteur PDF embarqué (zéro dépendance, hors connexion) utilise
  l'Helvetica / Helvetica-Bold, équivalent le plus proche d'Open Sans
  disponible sans fichier de police externe. Mêmes tailles que le Word.
- Couleurs inchangées : cyan `#06BAF2` (bandeaux, titre — famille du bleu
  `#5BB2DB` du logo), gris anthracite `#58595B` (famille du `#564F49` du logo).

## Nouvelles tailles
| Élément | Avant | Après |
|---|---|---|
| Corps de texte Word (défaut) | 11 pt | **13 pt** |
| Corps de texte PDF (paragraphes, évènements) | 8,8 pt | **10,8 pt** |
| Tableaux clé/valeur PDF (valeurs) | 8,6 pt | **10,6 pt** |
| Tableaux pièces / journées PDF | 8,2–8,5 pt | **10,2–10,5 pt** |
| Bandeaux de section PDF | 11,5 pt | **13,5 pt** |
| Bandeaux de section Word | 13 pt | **15 pt** (Poppins) |
| Bloc client / contact (nom) | 11,5–12 pt | **13,5–14 pt** |
| Légendes photos | 7,2–8,5 pt | **9,2–10,5 pt** |
| Signatures (nom, date, mentions) | 7,6–9,4 pt | **9,6–11,4 pt** |
| Pied de page PDF | 6,6–7,4 pt | **8,6–9,4 pt** |
| Pied de page Word | 8 pt | **10 pt** |
| Grand titre (déjà grand) | 30 pt | 30 pt (inchangé, + Poppins dans le Word) |

Les hauteurs de lignes, cadres et espacements ont été ajustés en proportion
(pas de texte coupé ni hors page — vérifié par génération de test).

## Fichiers modifiés
- `app/src/report.js` — tailles PDF (`size`) et Word (`taille`), Poppins sur
  les sous-titres Word.
- `app/src/docx.js` — support de `police` (paragraphes + cellules), Poppins
  sur titres/bandeaux, défaut Open Sans 13 pt, pied de page 10 pt.
- `app/src/pdf.js` — taille par défaut 9 → 11 pt.
- `VARIABLES-Compte-rendu.md` — mention des nouvelles polices.
- Reconstruit avec `python3 build.py --sans-liste` : `CR-Intervention-SAV.html`,
  `index.html`, `docs/`, `sw.js`, `.nojekyll`.

## Contenu de l'archive GitHub
Archive optimisée (< 100 fichiers) : dépôt complet **sans** `depot-public/`
(miroir obsolète qui doublonnait tous les fichiers) ni `.git/`.
À dézipper puis pousser sur le dépôt GitHub (branche `main`, GitHub Pages
sur `/docs`). Penser à regénérer `exemples/` (encore aux anciennes tailles)
depuis l'application.
