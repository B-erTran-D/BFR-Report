# SMS d'arrivée → appel pour un fixe — 28/10/2026

## Contact d'arrivée sur site : le bouton suit la nature du numéro
- **Numéro géographique (fixe : 01-05, ou +33 1-5…)** : la fenêtre « Prévenir le contact »
  propose maintenant **« Appeler le contact »** (lien `tel:`, lance le téléphone) au lieu de
  l'ouverture de l'application SMS. Le message pré-rempli est masqué (un appel n'a pas de texte).
- **Mobile (06/07/08/09)** : inchangé — ouverture de l'application SMS avec le message pré-rempli.
- Le bouton **bascule en direct** dès qu'on modifie le numéro dans la fenêtre.
- Les points d'entrée affichent aussi le bon libellé : lien sous le chrono (« SMS d'arrivée » /
  « Appeler le contact »), bouton dans la fiche client, item du menu ☰.
- Nouvel icône « téléphone » dans la charte des icônes (`app/src/icons.js`).

## Fichiers modifiés
- `app/src/icons.js` — icône `phone`.
- `app/src/app.js` — `estNumeroGeographique` / `nettoyerTel` / `contactArriveeAppel` / `icoContact` ;
  fenêtre `feuilleSMSArrivee` adaptée (appel/SMS) ; libellés des points d'entrée ; exposés dans `window.APP`.
- `tests/test_appli.py` — test `test_sms_ou_appel_arrivee` (classification des numéros, fixe → `tel:`,
  mobile → `sms:`, bascule en direct, libellé du menu).
- Reconstruit avec `python3 build.py --sans-liste` : `CR-Intervention-SAV.html`, `docs/`.

---

# Chrono sur plusieurs jours et annuaire — 16/10/2026

## Chrono : une journée par jour
- **Pause le soir, « Reprendre » le lendemain** : la journée de la veille s'arrête au début
  de la pause et rejoint le relevé des journées ; une nouvelle journée commence à la reprise.
  Avant, tout restait dans le même jour (de 8 h le lundi à 17 h le mardi).
- **« Terminer » puis « Reprendre »** : nouveau bouton après « Terminer ».
  - le même jour (pause déjeuner, aller-retour à l'atelier) : l'interruption est déduite
    comme une pause, on reste sur une seule journée ;
  - un autre jour : la journée précédente rejoint le relevé et le **jour 2** commence.
- **Chrono oublié la veille** : bandeau « Chrono lancé le … et jamais arrêté » ; « Corriger »
  (ou « Terminer » / « Pause ») demande l'heure de fin de cette journée et l'heure de reprise
  du jour. Un bouton permet de garder un travail continu (travail de nuit).
- Pendant une journée, le chrono affiche « Jour N — sur site depuis … », le temps de la
  journée, les jours précédents et le cumul. Le rapport (PDF, Word, e-mail) liste toutes les
  journées, celle en cours comprise (« en cours »), et le total cumulé.
- Une pause en cours n'est plus comptée comme du temps sur site ; une journée saisie à la
  main qui passe minuit (travail de nuit) est bien calculée.
- La date du jour est prise à l'heure française (entre minuit et 2 h, c'était la veille).

## Annuaire clients
- La **recherche** ne referme plus le clavier de l'iPhone à chaque lettre (le champ était
  redessiné à chaque frappe).
- **Client à plusieurs contacts** : « Modifier » ouvre bien le contact de la carte (avant,
  toujours le premier contact du client) ; modifier un contact n'efface plus les
  modifications faites sur un autre ; renommer un contact ne crée pas de doublon.
- Nouveau bouton **« Ajouter un autre contact pour ce client »**.
- Les **notes / autres contacts** saisis dans l'annuaire sont enfin enregistrés.
- Modifier un autre contact du client de l'intervention en cours ne remplace plus le contact
  de l'intervention (seuls adresse, lieu, logo et notes sont mis à jour).
- Message clair si l'enregistrement échoue (mémoire du navigateur pleine).

# « Liste trop lourde » — 16/10/2026

- **Cause :** la liste clients était enregistrée dans le localStorage du navigateur, limité
  à environ 5 Mo et **partagé** avec les rapports. Or l'appli y gardait aussi une copie
  de secours de l'historique **avec toutes les photos** : sur un téléphone qui a déjà servi,
  ces 5 Mo étaient pleins, et une liste de quelques centaines de Ko ne rentrait plus.
- La liste clients (et celle des techniciens) est maintenant rangée dans la base
  **IndexedDB** du navigateur, comme les rapports et les photos : plus de limite de 5 Mo.
  Une liste déjà chargée par une ancienne version y est déplacée automatiquement.
- La copie de secours de l'historique dans le localStorage est faite **sans les photos**
  (elles sont dans la base IndexedDB) : les Mo libérés servent de nouveau aux réglages et
  aux fiches clients, qui pouvaient eux aussi ne plus s'enregistrer.
- Les **logos** lourds du classeur sont réduits à 400 px à l'import (un logo de 4 Mo
  devient ~50 Ko) au lieu d'être écartés au-delà de 400 Ko.
- Message d'erreur plus juste si l'enregistrement échoue malgré tout (navigation privée).

# Nouvelle présentation du classeur clients — 15/10/2026

- Le classeur avec **une ligne par contact** s'importe : colonnes **Client, Titre, Nom,
  Prénom, Fonction, Téléphone, Mobile, Email** (dans n'importe quel ordre, reconnues par leur
  titre ; Adresse, Code postal, Ville, Pays et Logo sont aussi lus s'ils existent).
  - Contact = « Titre Prénom Nom » (« M. Paul MARTIN ») : le rapport écrit donc
    « À l'attention de M. Paul MARTIN ».
  - Téléphone du contact = le **mobile** s'il existe (pour le SMS d'arrivée sur site), sinon
    le fixe ; le fixe est gardé dans « autres contacts ».
  - Numéros remis en forme (« 06 12 34 56 78 »), y compris un mobile saisi comme un nombre
    dans Excel (le 0 perdu est rétabli).
  - Cellule « Client » fusionnée sur plusieurs contacts : chaque contact est rattaché au bon client.
  - E-mail du contact repris dans la fiche (et dans le rapport).
- Ce classeur n'ayant pas d'adresses ni de logos, ceux de la **liste déjà chargée** sont
  repris pour les clients qui y figuraient.
- Plusieurs contacts pour un même client : **tous restent proposés** quand on tape le nom du
  client (avec leur fonction), même après en avoir choisi un. Avant, le contact choisi une
  fois remplaçait les autres dans les propositions.
- Recherche aussi par le prénom ou le nom du contact (« sophie » trouve « Mme Sophie LEROY »).
- L'ancienne présentation (Client, Adresse, Contact, Logo) reste acceptée.

# Listes de propositions — 15/10/2026

- Les propositions des champs **Collègue sur site**, **Machine / équipement** et **Lieu
  d'intervention** s'affichaient dans le menu natif du navigateur (`<datalist>`) : noir en
  mode sombre (iPhone, Android, Windows), police et couleurs impossibles à régler. Elles sont
  remplacées par la même liste que celle des clients : fond blanc, noms en bleu BFR, 8
  propositions au plus, filtrées dès la première lettre (sans tenir compte des accents).
- Les messages en haut de l'écran (« 114 client(s) chargé(s)… ») ne se replient plus en
  une bulle étroite et haute : ils prennent la largeur du texte.

# Import de la liste clients — 15/10/2026

- **Le classeur Excel s'importe tel quel** (Réglages → Liste clients → « Mettre à jour la
  liste ») : fichier `.xlsx` d'Excel ou téléchargé depuis Google Sheets, sans passer par un
  export CSV. Avant, seuls le CSV et le JSON étaient lus : sur iPhone le `.xlsx` n'était pas
  sélectionnable, et sur ordinateur (Edge, Chrome) il était lu comme du texte et donnait une
  liste de « clients » illisibles.
- Les **logos** posés dans la colonne Logo du classeur sont repris avec chaque client.
- La rubrique **« Techniciens »** du classeur alimente la liste des collègues proposés sur
  le terrain (« Ajouter un collègue sur site »).
- Les colonnes sont reconnues par leur titre (Client, Adresse, Contact, Logo).
- CSV enregistré par Excel sous Windows (accents en encodage Windows, séparateur « ; ») :
  les accents sont maintenant corrects.
- Un fichier qui n'est pas une liste (image, ancien .xls…) affiche un message clair et ne
  remplace plus la liste en place ; une liste illisible importée par l'ancienne version est
  écartée automatiquement.
- Fonctionne hors connexion et sans bibliothèque externe ; sur les iPhone plus anciens
  (sans décompression intégrée au navigateur), l'appli décompresse le classeur elle-même.
- « Exporter la liste actuelle » inclut aussi la liste des techniciens.

# « Travaux terminés » — 15/10/2026

- **L'appli « oubliait » le choix Travaux terminés.** La correction automatique du
  français, lancée à chaque Aperçu PDF et à chaque Soumettre, traitait ce choix comme un
  texte et lui ajoutait un point : « Oui » devenait « Oui. ». La liste ne reconnaissait plus
  la valeur et réaffichait « — choisir — ». Le correcteur (et la traduction automatique) ne
  touchent plus à ce champ, et les rapports déjà abîmés (« Oui. ») retrouvent leur choix à
  l'ouverture.
- **« Travaux terminés » et « Fait le » apparaissent enfin dans le rapport** (ils étaient
  enregistrés mais jamais imprimés) : en tête de la partie Validation, juste au-dessus des
  signatures (Oui en vert, Partiellement en orange, Non en rouge), et dans la synthèse.
  Traduits dans les 6 langues ; variables {{travauxTermines}} et {{faitLe}} pour l'e-mail.

# Pied de page — 15/10/2026

- Le pied de page du PDF et du Word n'indique plus que **BFR SYSTEMS — 50 allée des
  érables, 01150 Blyes, France** (le siège social de Coulommiers est retiré).
- Réglages → Compte rendu : les deux champs « siège / 2e site » sont remplacés par
  **« Adresse(s) du pied de page »** (une ligne par adresse, deux au plus ; vide = Blyes).
  Ce réglage fait partie des réglages d'équipe.
- Le pied de page du Word est traduit dans la langue du client, comme celui du PDF.

# Dictée — 15/10/2026

- **La dictée ne s'arrête plus quand on se tait.** Le moteur de reconnaissance du
  téléphone coupe après quelques secondes de silence ; l'appli le relance aussitôt, sans
  perdre le texte. On a donc le temps de réfléchir entre deux phrases, et la dictée ne
  s'arrête qu'en touchant **« Arrêter la dictée »**.
- Témoin rouge « À l'écoute » sous les boutons tant que la dictée est active.
- On peut corriger le texte à la main pendant l'écoute : la suite de la dictée s'ajoute
  après la correction, sans l'écraser ni doubler de mots.
- Garde-fous : arrêt si le micro est refusé ou absent (message explicite), mise en pause si
  le téléphone refuse les relances en boucle, arrêt en quittant l'étape Annotation, arrêt
  après 3 minutes sans aucune parole (téléphone oublié dans la poche).

# Travaux réalisés et constats — 15/10/2026

Un rapport SAV ne se mélange plus avec un audit.

- **Chaque évènement a une nature**, choisie en haut de la première étape de l'assistant :
  - 🔧 **Travail réalisé** (ce que le technicien a fait) : pas de priorité, mais un
    **résultat** à l'étape 4 — **Terminé** (travail prévu : entretien, remplacement
    planifié…) / Résolu / Partiellement résolu / À surveiller (dépannage) ;
  - 🔍 **Constat** (ce qu'il a observé) : les priorités habituelles (Sécurité, Urgent,
    Haute, Basse, Informatif) et une case **« Corrigé sur place »** (mention verte
    « Corrigé sur place pendant l'intervention » dans le rapport).
- **Type d'intervention** dans la fiche Client & machine : SAV / dépannage, Audit,
  SAV + audit. Il donne le titre du rapport (« Compte rendu d'intervention »,
  « Rapport d'audit », « Compte rendu d'intervention et d'audit »), l'ordre des parties
  et la nature proposée par défaut dans l'assistant (SAV → travail, audit → constat,
  SAV + audit → la même que le dernier évènement).
  - SAV : Synthèse → Travaux réalisés → Points relevés (tous les constats, les plus
    prioritaires d'abord) → Travaux à prévoir → Pièces → Photos → Validation ;
  - Audit : Synthèse → constats par priorité → Travaux réalisés → … ;
  - SAV + audit : Synthèse → Travaux réalisés → Constats — Sécurité et urgences /
    Priorité haute / Priorité basse / Informations complémentaires → ….
  Le champ « Travaux réalisés » du compte rendu devient le résumé imprimé en tête de la
  partie Travaux réalisés.
- **Écran principal** : deux listes, « Travaux réalisés (n) » et « Constats (n) ». Chaque
  carte a un bouton **« En travail » / « En constat »** pour reclasser un évènement d'un
  appui (pratique pour les « Informatif » qui décrivaient en fait un travail).
- Synthèse du rapport : case verte « Travaux réalisés » + ligne « Constats corrigés sur
  place » ; les compteurs de priorités ne comptent que les constats.
- Les anciens rapports ne changent pas (leurs évènements sont des constats, plan standard)
  tant qu'on n'y ajoute pas de travail réalisé.
- Traductions des nouveaux libellés (EN, DE, NL, ES, IT, PT) ; les titres de parties
  renumérotés (« 3. Points de priorité haute ») sont de nouveau traduits.

Corrections
- Après avoir écrit dans un champ du compte rendu (Travaux réalisés, à prévoir…), le premier
  appui sur « Soumettre », « Word » ou « Aperçu PDF » était perdu (l'écran se redessinait
  sous le doigt). Corrigé.
- Le texte des cartes d'évènements prenait la hauteur minimale de la zone de saisie
  (cartes inutilement hautes). Corrigé.
- Aperçu débrief d'un évènement : les retours à la ligne du texte sont respectés.
- Word : propriétés de texte écrites dans l'ordre attendu par Word (fichier plus robuste).

# Correction et nouveautés du 14/10/2026

- **Dossier photos (.zip)** : bouton « Toutes les photos — dossier .zip » sous Soumettre le
  rapport (et dans l'écran d'envoi). Le zip contient `1-Evenements/`, `2-Pieces/`,
  `3-Photos-complementaires/`, des noms de fichiers parlants (n°, catégorie ou dénomination,
  référence) et `Liste-des-photos.csv` (ouvrable dans Excel : heure, domaine, catégorie,
  machine, texte, référence, quantité, légende).
- **Photos des pièces en grand** dans le tableau du PDF (2,5 cm au lieu de 1,3 cm, dénomination
  sur plusieurs lignes) et du Word (2,6 cm).

- PDF : les photos des pièces de rechange n'apparaissaient jamais dans le tableau des
  pièces (la case affichait « — »). Le code lisait un champ d'image inexistant
  (`jp.bytes`) au lieu de convertir l'image obtenue (`jp.dataUrl`). Défaut présent
  depuis la première version ; un test vérifie désormais la photo dans le PDF et le Word.

# Améliorations du 07/10/2026

## Rapport PDF et Word
- Mise en page des évènements selon le nombre de photos : 0 photo = texte seul,
  1 photo = texte à gauche et photo à droite, 2 photos = côte à côte, 3-4 = grille.
  Les évènements se suivent ; un évènement n'est jamais coupé entre deux pages.
  L'ancienne mise en page (une page par évènement) reste au choix dans Réglages.
- Word : les photos placées dans un tableau (pièces, évènements) sont enfin déclarées
  dans le fichier (elles pouvaient apparaître vides) ; légende toujours avec sa photo.

## Numéros de rapport uniques
- Le numéro contient le code du technicien : `RT-261007-01` (initiales par défaut,
  modifiable dans Mes informations). Plus de doublons entre techniciens le même jour.

## Historique
- La liste « Rapports enregistrés » ne charge plus aucune photo (résumés seulement) ;
  les photos sont chargées à la réouverture d'un rapport.
- Les rapports sont enregistrés sans leurs images (rangées à part) : base plus légère.
- Recherche par client, n°, machine ou date.
- Ménage des rapports terminés de plus de 6 mois, uniquement après une sauvegarde
  complète exportée ; les brouillons ne sont jamais supprimés.
- Supprimer un rapport supprime aussi ses photos.

## Réglages et ergonomie
- Plus aucune adresse e-mail dans le code publié ; nouveau fichier « réglages d'équipe »
  (export / import) pour configurer un téléphone neuf.
- Impossible de démarrer une intervention ou de soumettre un rapport sans nom de technicien.
- Les messages s'affichent en haut de l'écran (ils ne cachent plus le champ en cours de saisie).
- Boîtes de dialogue intégrées à l'application (les fenêtres du navigateur sont bloquées
  dans certains cadres, ex. artefact Claude) ; enregistrement des fichiers compatible.

## Tests automatiques
- `tests/test_appli.py` (5 scénarios de terrain dans un vrai navigateur) ; la GitHub Action
  ne publie que si tous les tests passent.

# Fusion avec la version de Bertrand du 06/10/2026

Reprises telles quelles depuis le dépôt de Bertrand (4 envois du 05 et 06/10) :
- **Annuaire clients** (Menu → Annuaire clients, et bouton « Annuaire complet » dans la fiche
  client) : consulter, créer, modifier ou réinitialiser une fiche client hors intervention.
- **SMS d'arrivée sur site** : message pré-rempli (FR/EN/DE/NL) au contact du client, ouvert
  dans l'application SMS du téléphone.
- **Pièces de rechange rattachées à une machine** (N° de série en priorité) : nouvelle colonne
  « Machine (N° série) » dans l'écran, le PDF et le Word.
- Choix d'un client dans la liste : les coordonnées de l'ancien client ne restent plus.
- Aperçu du logo client mis à jour immédiatement.
- Assistant d'évènement : machines affichées avec leur N° de série.

Toutes nos corrections du 05/10 (ci-dessous) sont conservées. Fichiers générés (docs/,
CR-Intervention-SAV.html) reconstruits à partir des sources fusionnées.

# Corrections du 05/10/2026

## Images absentes dans les anciens rapports
- **Cause** : jusqu'à la version précédente (copie `depot-public/`), l'historique des rapports
  était enregistré **sans les photos** (seul le rapport en cours les gardait). Les rapports
  rangés avec cette version n'ont plus leurs images sur le téléphone : elles ne sont
  récupérables que dans les PDF déjà envoyés ou dans une sauvegarde JSON exportée à l'époque.
- **Garde-fou** : un enregistrement ne peut plus remplacer une photo conservée par une version
  vide (copie allégée du stockage, sauvegarde incomplète) : l'image existante est reprise.
- Les photos « complémentaires » étaient enregistrées sous la clé `phl_…` mais relues sous
  `phlib_…` : relecture corrigée (les deux clés sont essayées).
- Les identifiants des photos sont attribués avant la copie enregistrée.
- Historique : un rapport dont des photos sont introuvables l'indique clairement.

## Bugs
- Numérotation du rapport (PDF et Word) recalculée : plus de saut « 2. » → « 10. ».
- Le corps de mail personnalisé n'est plus effacé à chaque ouverture (migration exécutée
  une seule fois).
- L'e-mail du responsable SAV n'est plus imposé : champ vide = pas d'envoi au SAV.
- Assistant d'évènement : le domaine est exigé dès l'étape 1.
- Rapport fantôme vide (numéro en double) créé au premier lancement : supprimé.
- Polices Open Sans / Poppins mises en cache par le service worker (hors connexion).

## Données
- Demande de stockage permanent (`navigator.storage.persist`) : Android ne doit plus effacer
  les rapports quand la mémoire est pleine.
- Rappel de sauvegarde au démarrage et dans le menu si aucune sauvegarde depuis 7 jours.

## Dépôt
- Supprimés : `depot-public/` (ancienne version), copies du site à la racine, icônes
  `icon-192/512` inutilisées, bouton « Ajouter pièce » en double.
- `build.py` fonctionne sans le fichier de liste clients et n'écrit plus que dans `docs/`.
- Publication automatique : `.github/workflows/pages.yml`.
