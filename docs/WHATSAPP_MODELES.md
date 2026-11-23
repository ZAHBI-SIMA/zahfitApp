# Modèles WhatsApp à faire valider par Meta

Hors d'une conversation ouverte par l'adhérent (fenêtre de 24 h), WhatsApp n'accepte que des **modèles pré-approuvés**. ZAHFIT n'envoie que des messages de **service** : catégorie **Utility** (« utilitaire »), jamais Marketing.

Source unique du texte : `modules/messaging/templates.ts`. Toute modification du texte doit être soumise de nouveau à Meta **avant** d'être déployée, sinon l'envoi échoue (l'adhérent reçoit alors le SMS de secours s'il y a consenti).

## Création (WhatsApp Manager → Modèles de message)

- Catégorie : **Utility**
- Langue : **Français** (`fr`, ou la valeur de `WHATSAPP_TEMPLATE_LANGUAGE`)
- Corps : le texte ci-dessous, variables `{{1}}`, `{{2}}`… dans l'ordre indiqué
- Aucun en-tête, pied de page ni bouton (le lien de renouvellement est dans le corps)

| Nom | Corps | Variables |
|---|---|---|
| `zahfit_rappel_echeance` | Bonjour {{1}}, votre abonnement {{2}} chez {{3}} se termine le {{4}}. Renouvelez en un clic : {{5}} | prénom · formule · salle · date de fin · lien |
| `zahfit_abonnement_expire` | Bonjour {{1}}, votre abonnement {{2}} chez {{3}} a pris fin le {{4}}. Renouvelez en un clic : {{5}} | prénom · formule · salle · date de fin · lien |
| `zahfit_seance_annulee` | Bonjour {{1}}, la séance {{2}} du {{3}} chez {{4}} est annulée. Votre réservation est libérée. | prénom · cours · date et heure · salle |
| `zahfit_place_liberee` | Bonjour {{1}}, une place s'est libérée : vous êtes inscrit(e) à {{2}} le {{3}} chez {{4}}. | prénom · cours · date et heure · salle |

Exemples à fournir à Meta : `Kevin`, `Mensuel`, `Salle Pilote Cocody`, `15/03/2027`, `https://app.zahfit.ci/s/pilote-cocody/renouveler/…`.

## Webhook

- URL de rappel : `https://<domaine>/api/webhooks/whatsapp`
- Jeton de vérification : la valeur de `WHATSAPP_VERIFY_TOKEN`
- Champs à souscrire : `messages` (statuts de livraison et réponses « STOP »)
- Les notifications sont signées avec le secret de l'application Meta (`WHATSAPP_APP_SECRET`) : une signature invalide est refusée (401).

## Règles appliquées par ZAHFIT

- Un message n'est envoyé que si la salle a activé le canal **et** que l'adhérent y a consenti (case cochée sur sa fiche ou à l'inscription).
- Réponse commençant par STOP, ARRÊT, ARRÊTER, DÉSINSCRIRE, DÉSABONNER ou UNSUBSCRIBE : consentement WhatsApp retiré dans **toutes** les salles où ce numéro est inscrit, avec une trace dans le journal d'audit.
- Échec WhatsApp (numéro sans WhatsApp, modèle refusé…) : SMS de secours, seulement si l'adhérent a consenti aux SMS. Chaque SMS contient un lien de désinscription signé.
- Le numéro complet est effacé du journal dès le statut final (remis, lu ou échec) ; seul un numéro masqué est conservé.
