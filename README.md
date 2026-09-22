# Fiche d'intervention S.A.V. — application terrain

Application web pour **téléphone** qui remplace le carnet à souche papier de BFR Systems :
saisie de la fiche, **signature du client au doigt**, génération du **PDF** de la fiche
(reproduction de la fiche papier + annexes) et **envoi par e-mail** au client et au
responsable SAV.

- Fonctionne **hors connexion** (atelier, sous-sol, zone sans réseau).
- Aucune donnée n'est envoyée à un serveur : tout est calculé **dans le téléphone**.
- Un seul code source, zéro dépendance à l'exécution (le moteur PDF est écrit sur mesure).

> Exemples de résultat (mêmes données) : [`exemples/CR-exemple-demonstration.pdf`](exemples/CR-exemple-demonstration.pdf) et [`exemples/CR-exemple-demonstration.docx`](exemples/CR-exemple-demonstration.docx)

---

## 1. Installation pour l'équipe — 5 minutes

> **Dépôt public, liste clients à part.** Cette image de l'application est publiée **sans la
> liste des clients** : ni dans les fichiers, ni dans l'historique du dépôt. Chaque technicien
> l'importe **une fois sur son téléphone** (☰ → Réglages → *Liste clients*) ; elle reste ensuite
> disponible hors connexion. La marche à suivre est dans
> **[`INSTALLATION-COLLEAGUES.md`](INSTALLATION-COLLEAGUES.md)**, la mise en ligne dans
> `GITHUB-depot-public.md` (conservé hors de ce dépôt).
> Site hors des moteurs de recherche (`noindex`). Code de l'application : public ; **données
> clients : jamais** (elles restent dans les téléphones).

Le principe reste le même : l'application se sert depuis une adresse web interne, et chaque
technicien l'ajoute à son écran d'accueil. Elle se comporte alors comme une application
installée et démarre sans réseau.

1. Le dépôt est déjà poussé (**dépôt public**) et le dossier **`docs/`** est déjà construit
   (`python3 build.py --sans-liste`).
2. Sur GitHub : **Settings → Pages → Source : *Deploy from a branch* → `main` → `/docs`**.
3. Diffuser l'adresse obtenue aux techniciens
   (`https://<compte>.github.io/<dépôt>/`) : elle s'installe comme une application.
4. Chaque technicien importe la liste clients une fois — voir
   **[`INSTALLATION-COLLEAGUES.md`](INSTALLATION-COLLEAGUES.md)**.

### Installer sur le téléphone Android (à faire une fois par téléphone)

1. Ouvrir l'adresse ci-dessus **dans Chrome**.
2. Menu **⋮** → **Ajouter à l'écran d'accueil** → *Installer*.
3. Ouvrir l'application depuis l'icône (elle démarre même sans réseau).
4. **☰ → Mes informations** : la fiche s'ouvre d'elle-même au premier lancement — Prénom, Nom,
   Téléphone, E-mail, puis la signature si on le souhaite. *(Une signature se photographie sur
   une feuille blanche ou s'importe depuis un scan.)* Ces valeurs sont conservées sur le
   téléphone et réutilisées pour toutes les interventions suivantes.
5. **☰ → Réglages** : logo et coordonnées de la société, e-mail du responsable SAV, canevas du
   rapport.

> Le PDF, la signature et les photos sont fabriqués localement : l'application fonctionne
> intégralement hors connexion. Seul l'envoi du mail nécessite du réseau.

### Variante sans hébergement

Le fichier **`CR-Intervention-SAV.html`** (à la racine du dépôt) est l'application complète
en un seul fichier : envoyez-le par mail ou copiez-le sur le téléphone, puis ouvrez-le avec
Chrome. Pratique pour dépanner, mais sans mémorisation entre deux ouvertures (utiliser le
bouton 💾 / l'export JSON du menu ☰). **L'installation PWA via GitHub Pages est recommandée.**

---

## 2. Utilisation sur le terrain

**Autocomplétion des clients** : dans *Client & machine*, tapez **3 lettres** du nom
(ex. `ENT`, `CFR`, `LAC`) → la liste BFR propose les correspondances (nom · ville · contact).
Le choix remplit d'un coup le nom, l'adresse, la ville, le contact (nom seul), la fonction et
le téléphone du client. Ce qui manque à la liste (téléphone, e-mail, logo, contact) se saisit
à la main : c'est **mémorisé dans le téléphone** et reproposé aux interventions suivantes.
La liste se met à jour depuis ☰ → Réglages → *Liste clients* (export CSV du classeur), et reste
disponible hors connexion.

**Avant la première intervention** : ☰ → **Mes informations** (la fiche s'ouvre toute seule
au premier lancement). On y saisit **Prénom, Nom, Téléphone, E-mail**, la fonction et — si
on veut — une photo de sa signature. Ces informations sont **mémorisées dans le téléphone**
et reprises automatiquement dans chaque nouveau rapport, sans jamais avoir à les retaper.

Déroulé de l'intervention, calqué sur la fiche papier :

| Étape | Contenu |
|---|---|
| **Client & machine** | Client par **autocomplétion** (3 lettres), contact sur site, fonction, téléphone du client, e-mail, adresse, lieu d'intervention, logo du client (facultatif), machine (machine / équipement, modèle, n° de série), objet de la demande, N° de rapport `AAMMJJ-NN` généré automatiquement |
| **Chrono** | Bouton **Démarrer l'intervention** : l'heure de début est horodatée. Pauses (repas, attente pièce) et fin d'intervention ; la durée sur site est calculée pauses déduites |
| **Ajouter un évènement** | Assistant en 4 étapes : **1. domaine** (mécanique / électrique / automatisme) → **2. annotation** écrite ou dictée, avec relecture vocale → **3. photo** prise au téléphone puis **annotée au doigt** (flèche, cercle, crayon, texte, 5 couleurs) → **4. catégorie** (🛑 Sécurité, ⚠️ Urgent, 🔺 Priorité haute, 🔽 Priorité basse, ℹ️ Informatif). L'évènement est **modifiable à tout moment** : on appuie dessus pour rouvrir l'assistant |
| **Compte rendu** | Résumé / synthèse, travaux réalisés, travaux à prévoir (base du devis), note interne |
| **Langue du client** | Case à cocher **« Traduire le rapport dans la langue du client »** (anglais, allemand, néerlandais, espagnol, italien, portugais). Décochée = **un seul rapport, en français**. Cochée = **deux rapports** : le français (version de référence) **et** la version dans la langue du client |
| **Signature** | Point client de vive voix puis **signature au doigt** sur l'écran, horodatée, nom et fonction du signataire |
| **Aperçu** | 👁️ **Aperçu PDF dans l'application** : les pages sont dessinées à l'écran (sans visionneuse PDF, que Chrome bloque), exactement comme le PDF final — puis téléchargement ou ouverture dans un onglet |
| **Soumettre le rapport** | PDF **et** version Word, **calqués sur le modèle « Compte rendu d'intervention » BFR** : logo en en-tête, bloc client, titre cyan, « Votre contact : », page destinataire « À Blyes, le … / À l'attention de … », bandeaux cyan par section, pied de page des deux sites |

Les catégories pilotent directement la mise en forme du PDF : compteurs par gravité en
synthèse, sections dédiées par catégorie, bandeau d'alerte en tête de liste dans l'application.

### Envoi du rapport

Bouton orange **📤 Envoyer** :

- le PDF est généré puis **partagé** (Gmail ou autre application, pièce jointe déjà prête) ;
- choisir les destinataires : le **client** (adresse saisie dans la fiche) et le
  **responsable SAV** (adresse enregistrée dans les réglages) ;
- le texte du mail est pré-rempli : synthèse des contrôles, écarts relevés, travaux à prévoir.

Autres options : **👁️ Aperçu** (contrôle avant envoi), **⬇️ PDF**, **✉️ E-mail** (destinataires
et texte pré-remplis), **📋 Copier le texte**.

### Rapport dans la langue du client

Dans *Client & machine*, la carte **Langue du client** :

- **case décochée** (client français) → **un seul rapport, en français** : rien ne change ;
- **case cochée** + choix de la langue → **deux rapports** sont créés et **joints au même
  mail** (client et responsable SAV dans le même message) : le rapport français
  (`Rapport_…pdf`) et sa version traduite (`Rapport_…_NL.pdf`, `_EN`, `_DE`, `_ES`, `_IT`, `_PT`).

Ce qui est traduit :

- **tous les libellés** du rapport (titres, tableaux, sections, mentions, pied de page,
  phrases du mail) par les **packs de langue embarqués** — donc **toujours disponibles,
  même sans réseau** ;
- **les textes saisis par le technicien** (objet, travaux, observations des évènements,
  synthèse, légendes, travaux à prévoir) par le **traducteur du téléphone** (Chrome Android,
  gratuit). Les **données du terrain ne sont jamais traduites** : nom du client, adresses,
  contacts, machine, n° de série, dates, heures, signature.

La langue est **mémorisée par client** : le rapport suivant chez le même client la repropose.
Le bouton **« Préparer la langue sur ce téléphone »** (même carte) télécharge la langue une
bonne fois au bureau ou en Wi-Fi : ensuite la traduction marche **hors connexion**.

Avant l'envoi, l'**aperçu** permet de relire les deux versions (boutons *Français* / *Nederlands*,
*English*…) et de corriger un mot si besoin (on rouvre l'évènement, on corrige, on resoumet).
Si le téléphone ne sait pas traduire (navigateur ancien), l'application le dit et laisse le
choix : envoyer le français seul, ou envoyer les libellés traduits avec les commentaires en
français.

Tout est **enregistré automatiquement** dans le téléphone. Le menu **☰** permet de créer une
nouvelle fiche, rouvrir une fiche précédente (historique), exporter/importer une sauvegarde
JSON (à faire régulièrement) et adapter les réglages.

---

## 3. Code source et mises à jour

Ce dépôt est une **image publiable** produite depuis le dépôt de travail interne par
`outils/preparer_depot_public.py` : le script recopie les fichiers publiables, reconstruit
l'application **sans la liste clients** (`python3 build.py --sans-liste`) et **refuse de
produire le dossier si un nom de client y subsiste**. Toute modification du code se fait donc
dans le dépôt de travail, puis se publie ici :

```bash
# dans le dépôt de travail interne
python3 outils/preparer_depot_public.py
cd depot-public && git add -A && git commit -m "mise à jour" && git push
```

Puis **Settings → Pages → Deploy from a branch → `main` → `/docs`** : la nouvelle version est
en ligne. Chaque téléphone la prend **à sa prochaine ouverture avec du réseau** (le service
worker va d'abord chercher la nouvelle version, puis sert le cache hors connexion). Le n° de
version en cours s'affiche dans ☰ → *Mode d'emploi* : si un téléphone reste en retard, le
rouvrir avec du réseau une seconde fois suffit. La liste importée sur chaque téléphone et les
rapports enregistrés ne sont pas touchés.

## 4. Structure du projet

```
CR-Intervention-SAV.html   application complète en 1 fichier (usage « à la main »)
docs/                      site publié (GitHub Pages) : installable, hors connexion
app/index.html             gabarit HTML
app/src/style.css          mise en forme (interface tactile, gros boutons)
app/src/pdf.js             moteur de génération PDF (aucune dépendance)
app/src/report.js          mise en page du rapport + texte des e-mails
app/src/clients.js         recherche client (3 lettres) + import du fichier de liste
app/src/langues.js         packs de langue du rapport (6 langues, hors connexion)
app/src/traduction.js      traduction des commentaires par le traducteur du téléphone
app/src/app.js             interface, signature, photos, temps, sauvegarde, envoi
build.py                   assemble le fichier unique et le site docs/ (icônes incluses)
modele/                    modèle « Compte rendu d'intervention » de référence
exemples/                  rapports de démonstration (PDF + Word)
```

### Modifier l'application

```bash
python3 build.py        # régénère CR-Intervention-SAV.html et docs/
```

Les tests automatisés (~170 vérifications, dont le rendu page par page du rapport) et l'outil
de préparation du fichier de liste clients restent dans le dépôt de travail interne.

### Personnalisation sans toucher au code

Tout se règle depuis **☰ → Réglages** dans l'application, et ces réglages sont sauvegardés
dans le téléphone (ils ne modifient pas le dépôt) :

- **identité du technicien** (Prénom, Nom, Fonction, Téléphone, E-mail, signature) — ☰ → *Mes informations*,
  utilisée dans l'en-tête et dans le bloc de signature de chaque rapport ;
- e-mail du responsable SAV, copie systématique, objet et corps du mail (avec variables
  `{{affaire}}`, `{{client}}`, `{{date}}`, `{{heures}}`, `{{ecarts}}`, `{{recommandations}}`…) ;
- **canevas du rapport** (ordre et contenu des sections) en JSON ;
- **domaines** (mécanique / électrique / automatisme) et **catégories** (libellé, icône, couleur) en JSON ;
- mention légale de signature du client ;
- **liste clients** (import de l'export CSV du classeur, disponible hors connexion).

Pour changer les valeurs par défaut **pour tous les techniciens** (nouvelle installation),
modifier `settingsDefaut` dans `app/src/app.js` puis relancer `build.py`.

---

## 5. Feuille de route

- [x] **Rapport dans la langue du client** (6 langues, libellés + commentaires, envoi unique).
- [ ] Chiffrage des pièces et de la main-d'œuvre (total HT/TTC, proposition de devis).
- [ ] Suivi du parc : historique par ligne/machine, alertes de périodicité.
- [ ] Envoi automatique par le serveur (SMTP) avec archivage central et copie au SAV.
- [ ] Référentiel clients/machines partagé (import CSV).
