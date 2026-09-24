# Mise à jour « Deux e-mails distincts » (24/09/2026)

## Demande
Avant : un seul mail (client + SAV ensemble, corps toujours en français).
Après : **2 boutons distincts** dans l'écran d'envoi.

## Les deux mails
|  | 1. Mail SAV | 2. Mail client |
|---|---|---|
| **À** | Responsable SAV (`mail.destinataireSAV`) | Client (`client.email` de la fiche) |
| **Cc** | Technicien + **assistante SAV** (`mail.assistanteSAV`, nouveau) + copie systématique | Copie systématique |
| **Pièces jointes** | PDF français + PDF traduit (pour info) | PDF traduit + PDF français (en référence) |
| **Objet / corps** | Modèles des Réglages, **français** (+ note « version … également jointe » si traduction) | **Modèles fixes pré-traduits** (option A) |
| **Inactif si** | — | E-mail du client non renseigné |

Les deux mails joignent donc les mêmes PDF ; seuls les destinataires et la
langue du message changent. Pas de 3ᵉ option « tout en un mail » (refusée).

## Choix par défaut (modifiables en 1 ligne si besoin)
- **Copie systématique** (`mail.destinatairesCopie`) : envoyée **sur les 2 mails**
  (fonction `composerDests` dans `app/src/app.js`).
- **Assistante SAV** : en Cc du **mail SAV uniquement**.
- **Technicien** : en Cc du **mail SAV uniquement**.

## Technique
- `app/src/langues.js` : `MODELES_MAIL` (objet + corps en EN/DE/NL/ES/IT/PT,
  mêmes `{{variables}}` que le français, remplies avec les données brutes) et
  `I18N.modeleMail(code)`. `PHRASES`/`phraseTraduction` conservés (compatibilité).
- `app/src/report.js` : `objetMail(i, s, langue)` et `corpsMail(i, s, langue)`
  (modèle traduit si `langue` fournie, sinon modèles FR des Réglages) ;
  nouveau `noteTraductionJointe(code)` pour la note SAV.
- `app/src/app.js` : `destinatairesSAV()` / `destinatairesClient()` (+ `lienMailto`,
  `tamponEnvoi`) ; `destinatairesMail()` historique conservé (muxé, inutilisé
  par l'interface) ; feuille d'envoi à 2 sections avec pastilles
  « Envoyé le … ✓ » (`R.envoyeSAV` / `R.envoyeClient` horodatés dans la fiche) ;
  Réglages : nouveau champ assistante, suppression des cases « Envoyer aussi
  au client / au responsable SAV » (remplacées par les 2 boutons), aide à jour.
- Testé en Node : objet + corps générés dans les 6 langues (variables
  substituées, mentions des 2 pièces jointes), chemins FR inchangés.
- Reconstruit avec `python3 build.py --sans-liste`.
