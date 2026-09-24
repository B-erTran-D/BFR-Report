# Installer l'application sur un téléphone (Android)

Application d'intervention SAV — BFR Systems. Elle remplace le carnet à souche :
chrono des heures sur site, photos annotées, évènements, signature du client au doigt,
rapport PDF + Word envoyé au client et au responsable SAV. **Elle fonctionne sans réseau.**

---

## 1. Installer (2 minutes, une seule fois par téléphone)

1. Ouvrir l'adresse de l'application **dans Chrome**.
2. Menu **⋮** (en haut à droite) → **Ajouter à l'écran d'accueil** → **Installer**.
3. L'icône apparaît sur l'écran d'accueil : l'application s'ouvre comme les autres,
   en plein écran, et démarre **sans connexion** (les données restent dans le téléphone).

> **Important** : garder toujours la même adresse. Si l'adresse change, le téléphone voit
> un « nouveau site » et il faut réinstaller + réimporter la liste clients (5 minutes).

## 2. Renseigner mes informations (une seule fois)

**☰ → Mes informations** : prénom, nom, téléphone, e-mail (et poste si besoin).
Elles sont mémorisées dans le téléphone et reprises automatiquement sur chaque rapport
(contact technique, e-mail, téléphone imprimés en page 1).

## 3. Charger la liste des clients (une seule fois)

La liste des clients n'est **pas** dans l'application publiée : chacun la charge sur son
téléphone. Elle reste ensuite dans le téléphone et s'utilise **hors connexion**.

1. Récupérer le fichier de la liste, fourni par le responsable SAV :
   - `clients-bfr-AAAA-MM-JJ.json` (recommandé) ou
   - l'export CSV du classeur « COORDONNÉES CLIENTS ».
   On le reçoit par mail, messagerie d'équipe ou Bluetooth.
   *Un collègue qui l'a déjà peut aussi vous l'envoyer : ☰ → Réglages → **Exporter la liste
   actuelle** — le fichier obtenu s'importe de la même façon.*
2. Dans l'application : **☰ → Réglages → Liste clients**.
3. Appuyer sur **📥 Mettre à jour la liste (export CSV du classeur ou JSON)** et choisir le fichier.
4. Le message **« 114 client(s) chargé(s) ✔ — disponible hors connexion »** confirme le chargement.
5. Vérifier : dans une intervention, **Client & machine → Client**, taper 3 lettres (`ENT`, `CFR`…)
   → les propositions apparaissent avec la ville et le contact.

**Mise à jour de la liste** (nouveau client, adresse corrigée) : même écran, réimporter le
nouveau fichier — il remplace l'ancien. Le bouton **Revenir à la liste d'origine** efface la
liste importée si nécessaire.

## 4. Sur le terrain

- **Démarrer / arrêter** le chrono à l'arrivée et au départ : les heures sur site se calculent
  toutes seules (pauses comprises).
- **Intervention sur plusieurs jours (multi-jours)** : appuyer sur **« ✏️ Ajuster »** ou le chrono,
  cocher **« Intervention sur plusieurs jours (multi-jours) »** et renseigner les horaires, temps de
  pause et travaux réalisés pour chaque journée. Les heures cumulées se calculent automatiquement
  et sont détaillées dans un tableau dédié du rapport.
- **Intervention sur plusieurs machines** : dans la fiche *Client & machine*, appuyer sur
  **« ➕ Ajouter une autre machine »** (machine, modèle, n° de série). Lors de l'ajout d'un
  évènement, un sélecteur permet de rattacher le constat / la photo à la machine concernée.
- **Intervention en équipe (binôme / collègues sur site)** : dans la fiche client, appuyer sur
  **« ➕ Ajouter un collègue sur site »** (autocomplétion des techniciens BFR et spécialité :
  automaticien, mécanicien...). Le technicien principal reste le signataire et interlocuteur,
  et les collègues accompagnants sont mentionnés dans les contacts et signatures du rapport.
- **Ajouter un évènement** : domaine (mécanique / électrique / automatisme) → texte **ou dictée
  vocale** → photo (annotation au doigt) → catégorie (Sécurité, Urgent, Priorité haute, Basse,
  Informatif). Chaque évènement reste **modifiable à tout moment**.
- **Pièces de rechange** : bouton **« ➕ Ajouter pièce de rechange »** (dénomination, référence, quantité)
  pour les pièces neuves remplacées ou laissées dans le stock client. Elles figurent dans un tableau
  dédié du rapport et la signature du client vaut acceptation du devis final.
- **Fin d'intervention** : point avec le client, explication de vive voix, puis **signature du
  client** au doigt sur l'écran.
- **Client étranger** : dans *Client & machine*, cocher **« Traduire le rapport dans la langue
  du client »** et choisir la langue (anglais, allemand, néerlandais, espagnol, italien,
  portugais). Deux rapports sont alors envoyés dans le même mail : le français **et** la
  version traduite. La langue est retenue pour ce client (reproposée la fois suivante).
  Un appui sur **« Préparer la langue sur ce téléphone »**, au bureau ou en Wi-Fi, télécharge
  la langue une bonne fois : ensuite la traduction fonctionne **même sans réseau**.
- **Soumettre le rapport** : le PDF (+ Word) est créé dans le téléphone, puis envoyé en
  **deux e-mails distincts** par mail / partage Android (Gmail) : **1. Mail SAV** (français,
  au responsable SAV) puis **2. Mail client** (objet et message dans sa langue). Chaque
  envoi est horodaté (« Envoyé le … ✓ »). L'envoi demande du réseau ;
  **la création du rapport, elle, marche hors connexion**.
- **Historique** : les rapports sont conservés dans le téléphone (relisibles, réexportables).

## 5. Précautions

- Ne pas faire **« Effacer les données »** sur ce site (Chrome → Paramètres du site) : cela
  viderait la liste importée et les rapports. Si cela arrive : réimporter le fichier de la liste.
- Mettre l'application à jour = **rouvrir l'application avec du réseau** (elle vérifie la
  nouvelle version au lancement et la recharge si besoin) ; la liste clients importée et les
  rapports enregistrés sont conservés. Le **n° de version** en cours figure dans
  ☰ → *Mode d'emploi*, tout en bas.
- Aucune donnée client n'est envoyée à un serveur : rapports et listes restent dans les
  téléphones, les mails partent du compte mail du technicien.

## 6. En cas de souci

- **Aucune proposition de client** : la liste n'est pas chargée (revoir § 3).
- **L'adresse ne s'ouvre pas** : vérifier la connexion (Chrome « Actualiser ») ; l'application
  installée, elle, fonctionne hors connexion.
- **Le mail ne part pas** : la création du rapport est bonne, choisir Gmail / Outlook dans la
  fenêtre de partage, ou réessayer avec du réseau ; le PDF est disponible dans l'application.
- **La version traduite n'est pas complète** (commentaires restés en français) : la langue
  n'avait pas encore été téléchargée sur ce téléphone au moment de l'envoi. Rouvrir la fiche
  du client, appuyer sur **« Préparer la langue sur ce téléphone »** avec du réseau, puis
  resoumettre le rapport.
- **Pas de traduction du tout sur ce téléphone** : mettre **Chrome à jour** (menu ⋮ →
  *Mettre à jour Chrome*). Les libellés du rapport sont de toute façon traduits ; seuls les
  commentaires saisis resteraient en français.
- **L'application est restée sur l'ancienne version** (pas de nouveauté affichée) : comparer
  le n° de version de ☰ → *Mode d'emploi* avec celui annoncé par le responsable. Si le
  téléphone est en retard : rouvrir l'application **avec du réseau**, la fermer, la rouvrir
  (après une mise en ligne, un téléphone peut demander ces deux ouvertures ; ensuite la
  nouvelle version est prise au lancement). En dernier recours, dans Chrome :
  Paramètres → Confidentialité → **Effacer les données de navigation** → cocher
  **« Données des sites »** : ⚠️ cela vide aussi la liste clients importée et les rapports —
  réimporter la liste (§ 3) et ressaisir vos informations après.
