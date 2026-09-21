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
- **Ajouter un évènement** : domaine (mécanique / électrique / automatisme) → texte **ou dictée
  vocale** → photo (annotation au doigt) → catégorie (Sécurité, Urgent, Priorité haute, Basse,
  Informatif). Chaque évènement reste **modifiable à tout moment**.
- **Fin d'intervention** : point avec le client, explication de vive voix, puis **signature du
  client** au doigt sur l'écran.
- **Soumettre le rapport** : le PDF (+ Word) est créé dans le téléphone, puis envoyé au client
  et au responsable SAV par mail / partage Android (Gmail). L'envoi demande du réseau ;
  **la création du rapport, elle, marche hors connexion**.
- **Historique** : les rapports sont conservés dans le téléphone (relisibles, réexportables).

## 5. Précautions

- Ne pas faire **« Effacer les données »** sur ce site (Chrome → Paramètres du site) : cela
  viderait la liste importée et les rapports. Si cela arrive : réimporter le fichier de la liste.
- Mettre l'application à jour = **rouvrir la page** (l'application se met à jour toute seule) ;
  la liste clients importée et les rapports enregistrés sont conservés.
- Aucune donnée client n'est envoyée à un serveur : rapports et listes restent dans les
  téléphones, les mails partent du compte mail du technicien.

## 6. En cas de souci

- **Aucune proposition de client** : la liste n'est pas chargée (revoir § 3).
- **L'adresse ne s'ouvre pas** : vérifier la connexion (Chrome « Actualiser ») ; l'application
  installée, elle, fonctionne hors connexion.
- **Le mail ne part pas** : la création du rapport est bonne, choisir Gmail / Outlook dans la
  fenêtre de partage, ou réessayer avec du réseau ; le PDF est disponible dans l'application.
