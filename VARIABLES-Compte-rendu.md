# Modèle « Compte rendu d'intervention » — variables à définir

Source : `modele/Compte-rendu-BFR-modele.docx` (export du Google Doc fourni, conservé tel quel comme référence).

**11 variables distinctes, 13 emplacements** (dont `{Date}` et `{Client_Name}` employés deux fois). Il n'y a **aucune autre accolade** dans le document (vérifié sur `word/document.xml`).

## À compléter

Colonne « Votre définition » : à remplir / corriger. Dernière colonne : ce que l'application sait déjà produire toute seule.

| # | Variable | Où dans le modèle | Ce que je comprends | Votre définition | Alimenté par l'appli ? |
|---|---|---|---|---|---|
| 1 | `{Client_Name}` | En-tête, tableau 1 (1re cellule, ligne 1) **et** corps page 2, 1re ligne | Nom du client | | ✅ `client.nom` |
| 2 | `{Mail_Client}` | En-tête, tableau 1 (1re cellule, ligne 2) | E-mail du client (« à qui le rapport part ») | | ✅ `client.email` (à saisir) |
| 3 | `{numero_client}` | En-tête, tableau 1 (1re cellule, ligne 3) | **Téléphone du client** — repris de la liste s'il existe, sinon saisi dans l'appli | ✅ téléphone du client | ✅ `client.tel` (repris ou saisi) |
| 4 | `{Logo_Client}` | En-tête, tableau 1 (3e cellule) | Logo du client — **vide si le client n'en a pas** (place laissée vide) | ✅ si vide, on laisse vide | ✅ `client.logo` (photo ou vide) |
| 5 | `{Date}` | Titre « Compte rendu d'intervention {Date} » **et** « À Blyes, le {Date}, » | Date du compte rendu (jour d'édition ou d'intervention ?) | | ✅ `rapport.date` |
| 6 | `{Name_Technicien}` | Tableau 2 « Votre contact », 1re ligne | Nom et prénom du technicien | | ✅ fiche *Mes informations* |
| 7 | `{Poste_Tech}` | Tableau 2, 2e ligne | Fonction / poste du technicien | | ✅ `technicien.fonction` |
| 8 | `{Mail_Tech}` | Tableau 2, 3e ligne | E-mail du technicien | | ✅ *Mes informations* |
| 9 | `{Num_Tech}` | Tableau 2, 4e ligne | Téléphone du technicien | | ✅ *Mes informations* |
| 10 | `{Client_Adress}` | Corps page 2, 2e ligne *(noté « Adress » dans le modèle)* | Adresse complète du client, sur plusieurs lignes | | ✅ colonne « Adresse » de la liste |
| 11 | `{Client_Contact}` | Corps page 2, « À l'attention de {Client_Contact}, » | Nom du contact sur site | | ✅ colonne « Contact » (qui contient aussi souvent fonction + téléphone) |

## État : modèle intégré au rapport généré (21/09/2026)

Le rapport PDF et Word suivent maintenant la structure du modèle :

| Modèle | Rapport généré |
|---|---|
| Logo BFR en en-tête (10,2 cm) | ✅ en en-tête de chaque page (logo BFR par défaut, remplaçable dans ☙ Réglages) |
| Tableau client `{Client_Name}` `{Mail_Client}` `{numero_client}` + `{Logo_Client}` | ✅ bloc en page 1 (logo client à droite, **place laissée vide** s'il n'y en a pas) |
| Titre « Compte rendu d'intervention » + `{Date}`, cyan #06BAF2, centré | ✅ identique (titre + date, cyan du modèle) — titre en **30 pt** (le modèle est à 36 pt, ramené pour rester sur une ligne) |
| Tableau « Votre contact : » `{Name_Technicien}` `{Poste_Tech}` `{Mail_Tech}` `{Num_Tech}` | ✅ bloc technicien (fiche *Mes informations*) |
| `{Client_Name}` / `{Client_Adress}` / « À Blyes, le {Date}, » / « À l'attention de {Client_Contact}, » | ✅ page destinataire complète, ville réglable dans ☙ Réglages |
| Bandeaux de section cyan, texte blanc en petites capitales | ✅ tous les titres de section |
| Pied de page (siège Coulommiers + site de Blyes) | ✅ sur toutes les pages, + « Page n / N » |

Le corps (intervention, synthèse, évènements par catégorie, photos, signature) s'enchaîne après la page destinataire, avec les mêmes bandeaux cyan.
Police du Word : **Open Sans 13 pt** pour le corps, **Poppins** pour les titres et bandeaux (charte graphique BFR Systems : Poppins & Open Sans, comme le site bfrsystems.com) ; en-tête et pied de page répétés sur chaque page. Le PDF utilise l'Helvetica (équivalent hors-connexion, sans dépendance) avec les mêmes tailles relevées de 2 pt minimum.

## Ce que le modèle contient déjà (et pas seulement des variables)

- **Logo BFR** (image extraite : `assets/logo-bfr.png`) en première page.
- **Pied de page** : *BFR SYSTEMS — Siège social et site de production n°1 – 1, rue du Jariel, ZAC Les Longs Sillons, 77120 Coulommiers, France — Site de production n°2 – 50 allée des érables, 01150 Blyes, France* (`assets/modele-bas-de-page.png`).
- Mise en forme : A4 portrait, marges 1,9 cm (gauche/droite) et 2,54 cm (haut/bas), police **Open Sans 11**, 2 sauts de page.
- Le document s'arrête après « À l'attention de … ». Les pages 3 et 4 sont **vides** : le corps du compte rendu (constats, temps passé, photos, signatures) reste à définir.

## Réponses obtenues le 21/09/2026

1. **`{numero_client}` = téléphone du client**, renseignable dans l'application s'il n'est pas dans la liste déroulante. → repris de la colonne « Contact » quand un numéro y figure, sinon champ *Téléphone du client* (mémorisé).
2. **`{Logo_Client}`** : si le client n'a pas de logo, **on laisse vide**.
3. **`{Client_Contact}` = nom seul** du contact (pas la fonction ni le téléphone), renseignable dans l'application si absent.

## Reste à trancher
4. **`{Date}`** : date d'intervention ou date d'édition du compte rendu ?
5. **Corps du compte rendu** : ce modèle devient-il toute la trame (donc on y insère synthèse, évènements classés par catégorie, temps passé, photos numérotées, blocs de signature), ou reste-t-il en page de garde ?
6. **Liste clients** : 114 clients retenus (le reste du classeur = lignes vides + un bloc « Techniciens » de 31 lignes, dont 15 numérotées 1 à 15). Contient aussi 6 doublons de nom (`CLIENT EXEMPLE 1`, `CLIENT EXEMPLE 2`, `CLIENT EXEMPLE 3`, `CLIENT EXEMPLE 4`, `CLIENT EXEMPLE 5`, `CLIENT EXEMPLE 6`) → plusieurs sites par client, à départager par l'adresse.
7. **Liste des techniciens** : noms seuls, sans téléphone ni e-mail. Doit-elle préremplir la fiche *Mes informations* (choix dans une liste au lieu de la saisie) ?
8. **Coordonnées BFR de l'appli** : le pied de page du modèle est plus complet que les valeurs actuelles de l'application (`01150 BLYES`). Téléphone, e-mail et site web à confirmer pour l'en-tête des rapports.

## Données récupérées dans le dépôt

| Fichier | Contenu | Versionné ? |
|---|---|---|
| `modele/Compte-rendu-BFR-modele.docx` | Le modèle de référence, tel quel | oui |
| `modele/clients-BFR.csv` | Liste clients + techniciens (export brut du classeur) | **non** (`.gitignore`) — voir note sécurité |
| `app/src/clients-data.js` | Liste clients extraite, embarquée dans l'application (autocomplétion hors connexion) | oui — ⚠️ voir note sécurité |
| `outils/extraire_clients.py` | Script d'extraction (CSV du classeur → JSON/JS) | oui |
| `assets/logo-bfr.png` | Logo BFR extrait du modèle | oui |
| `assets/modele-bas-de-page.png` | Bandeau d'adresses du pied de page | oui |

> ⚠️ **Sécurité** — à trancher : la liste clients (noms, adresses, contacts, téléphones) est maintenant **embarquée dans l'application** pour l'autocomplétion hors connexion. Si le dépôt GitHub est **public**, elle devient lisible par tout le monde (GitHub Pages est public même gratuit).
> - **Dépôt public** → construire sans la liste : `python3 build.py --sans-liste`, puis chaque technicien charge le classeur une fois dans ☰ → Réglages → *Liste clients* (l'application la garde dans le téléphone).
> - **Dépôt privé** (ou équipe restreinte) → garder la liste embarquée : rien à faire, l'autocomplétion marche dès l'installation.
