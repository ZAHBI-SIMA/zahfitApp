# Accès de test (environnement local)

Ces comptes sont créés par `pnpm db:seed`, **uniquement sur votre base locale**. Le seed refuse de s'exécuter si `NODE_ENV=production`. Ne le lancez jamais sur un serveur accessible depuis Internet : le mot de passe ci-dessous est public.

- **URL** : http://localhost:3100/connexion
- **Mot de passe commun** : la valeur de `SEED_PASSWORD` dans [`.env.example`](../.env.example), recopiée dans votre `.env`

## Comptes

| E-mail | Rôle | Salle | Arrive sur | 2FA |
|---|---|---|---|---|
| `superadmin@zahfit.local` | Super Admin ZahDigit | toutes | `/super-admin` | **obligatoire** |
| `admin@pilote.zahfit.local` | Administrateur | Salle Pilote Cocody | `/admin` | **obligatoire** |
| `gerant@pilote.zahfit.local` | Gérant | Salle Pilote Cocody | `/admin` | **obligatoire** (peut rembourser) |
| `accueil@pilote.zahfit.local` | Réceptionniste | Salle Pilote Cocody | `/reception` | — |
| `coach@pilote.zahfit.local` | Coach | Salle Pilote Cocody | `/coach` | — |
| `compta@pilote.zahfit.local` | Comptable | Salle Pilote Cocody | `/admin` (lecture financière) | — |
| `adherent@pilote.zahfit.local` | Adhérent | Salle Pilote Cocody | `/member` | — |
| `admin@plateau.zahfit.local` | Administrateur | Démo Fitness Plateau | `/admin` | **obligatoire** |

### Double authentification (comptes marqués « obligatoire »)

À la première connexion, l'application ouvre `/securite/2fa` :

1. installez Google Authenticator, Microsoft Authenticator ou 2FAS sur votre téléphone ;
2. confirmez le mot de passe, puis scannez le QR Code ;
3. **notez les codes de secours** ;
4. saisissez le code à 6 chiffres.

Pour tester sans 2FA, mettez `ENFORCE_2FA="false"` dans votre `.env` (**local uniquement**).

Pour réinitialiser la 2FA d'un compte de démo, en tant que `postgres` sur la base `zahfit` :

```sql
DELETE FROM two_factors WHERE user_id = (SELECT id FROM users WHERE email = 'admin@pilote.zahfit.local');
UPDATE users SET two_factor_enabled = false WHERE email = 'admin@pilote.zahfit.local';
```

## Scénarios conseillés

| Scénario | Compte | Résultat attendu |
|---|---|---|
| Inscrire un adhérent avec un téléphone invalide, puis valide | accueil | Erreur sous le champ sans perte de saisie, puis fiche `ADH-00000x` |
| Importer un CSV (modèle téléchargeable sur la page Import) | admin | Aperçu à importer / doublon / erreur, puis import |
| Archiver puis restaurer un adhérent, consulter l'historique | admin | Historique « Inscription → Archivage → Restauration » |
| Ouvrir `/admin` avec le compte réceptionniste | accueil | Redirection vers `/reception` |
| Inviter un membre de l'équipe | admin | Lien d'activation affiché dans la **console du serveur** (`[mail:dev]`) |
| Se rétrograder soi-même / désactiver le dernier admin | admin | Refusé |
| Créer une salle, puis la suspendre avec un motif | superadmin | L'équipe de la salle voit « accès suspendu » |
| Comparer les adhérents des deux salles | admin pilote, puis admin plateau | Chaque salle ne voit que les siens (RLS) |
| Attribuer « Mensuel » + encaisser en Mobile Money **sans** référence, puis avec | accueil | Refus sans référence, puis abonnement « En cours » |
| Suspendre puis reprendre un abonnement | accueil | Statut « Suspendu », puis fin repoussée des jours gelés |
| Renouveler avant la fin | accueil | Le nouvel abonnement démarre le lendemain de la fin actuelle |
| Prolonger de 7 jours avec un motif / annuler un abonnement payé | gerant | Autorisé (bouton absent pour la réceptionniste) |
| Créer ou modifier une formule (prix, restrictions, jours de gel) | admin | Les abonnements déjà vendus gardent leur ancien prix |
| Consulter les listes « À renouveler », « Expirés », « En attente » | accueil ou admin | Listes de suivi à jour |
| Se connecter en adhérent | adherent | « Mon abonnement » avec le nombre de jours restants, et « Mes reçus » |
| Ouvrir un reçu depuis la fiche (lien REC-…) | accueil | PDF A5 aux couleurs de la salle |
| Activer le paiement partiel (Paramètres → Encaissements, acompte 50 %) | admin | Encaisser 10 000 sur 20 000 → abonnement actif, solde dans « Encaisser » |
| Rembourser une partie d'un paiement | gerant | Avoir AV-… émis, chiffre d'affaires du jour diminué |
| Journal des paiements + « Exporter » | compta | Fichier CSV qui s'ouvre dans Excel |

## Contrôle d'accès (QR Code et badge)

| Scénario | Compte | Résultat attendu |
|---|---|---|
| Ouvrir « Mon QR Code » | adherent | QR renouvelé toutes les 30 s, formule en cours affichée |
| Fiche de Kevin → « Émettre un badge », puis « Imprimer le badge » | accueil | Code `ZB-…` affiché une seule fois, carte imprimable |
| « Contrôle d'accès » → taper le code du badge + Entrée (comme une douchette) | accueil | Vert « ACCÈS AUTORISÉ », photo ou initiales, formule, fin |
| Rescanner aussitôt | accueil | Rouge « Déjà entré il y a moins de 60 min » (anti-passback) |
| Taper n'importe quoi | accueil | Rouge « Code non reconnu », passage tout de même journalisé |
| « Scanner avec la caméra » puis présenter le QR du téléphone de l'adhérent | accueil | Même résultat qu'avec la douchette (autoriser la caméra) |
| Renouveler puis révoquer le badge | accueil | L'ancien code est refusé (« Badge inconnu ou révoqué ») |
| Couper le Wi-Fi de l'appareil de l'accueil et scanner | accueil | Décision prise sur l'appareil, « 1 passage à synchroniser » ; envoyé au retour du réseau |
| Paramètres → Contrôle d'accès : anti-passback à 0 | admin | Deux scans rapprochés sont acceptés |
| « Fréquentation » | admin, gerant | Entrées par jour et par heure, motifs de refus, journal filtrable |

Sur l'appareil de l'accueil, l'écran de scan garde en cache les droits des adhérents (sans téléphone ni e-mail) pour fonctionner sans réseau. Utilisez un appareil réservé à l'accueil.

## Planning des cours

Le seed crée un planning de démonstration : 3 types de cours (Cross-training, Yoga, Zumba), 2 salles de cours et 4 cours réguliers animés par Serge Bamba (compte coach).

| Scénario | Compte | Résultat attendu |
|---|---|---|
| « Mes cours » | coach | Ses séances des 14 prochains jours |
| « Planning » → vue Semaine, puis un jour, flèches ← → | coach, accueil | Planning de la salle, en lecture |
| « Mon profil » : saisir `6h-12h` un jour, enregistrer | coach | Erreur sous le champ, saisie conservée |
| « Mon profil » : disponibilités au format `06:00-12:00, 17:00-21:00` | coach | « Profil enregistré » |
| Planning → « Cours réguliers, types et salles » → nouveau cours régulier | admin, gerant | 8 semaines de séances créées |
| Créer un cours au même moment pour le même coach ou la même salle | admin | Refusé : « Conflit le … » |
| Programmer un coach hors de ses disponibilités | admin | Refusé, avec le jour et l'heure |
| Cliquer une séance → la modifier (remplaçant, horaire) | admin | Séance marquée « Modifiée », conservée si le cours régulier change |
| Annuler une séance avec un motif, puis la rétablir | gerant | Barrée « Annulée — motif », puis rétablie |
| Arrêter un cours régulier à une date | admin | Séances suivantes retirées |
| Équipe → nom d'un membre | admin | Profil employé (spécialités, disponibilités) |

Les séances sont générées 8 semaines à l'avance. En production, appelez chaque jour `GET /api/cron/planning` avec l'en-tête `Authorization: Bearer <CRON_SECRET>` pour prolonger le planning.

## Réservations, présences et notifications

| Scénario | Compte | Résultat attendu |
|---|---|---|
| « Réservations » → « Réserver » sur une séance | adherent | La séance passe dans « Mes réservations », une place de moins |
| « Notifications » | adherent | « Réservation confirmée », puis « Tout marquer comme lu » |
| Annuler sa réservation moins de 2 h avant le cours | adherent | Refusé : « prévenez l'accueil » |
| Planning → une séance → « Inscrire un adhérent » avec `ADH-000005` | accueil | Inscrit ; e-mail de confirmation dans la console du serveur |
| Inscrire un adhérent déjà inscrit | accueil | « Déjà inscrit(e) à cette séance » |
| Séance pleine : inscrire un adhérent de plus | accueil | Mis en liste d'attente ; confirmé automatiquement si une place se libère |
| « Mes cours » → une séance → Présent / Absent (30 min avant le cours au plus tôt) | coach | Présence enregistrée, taux de présence sur 30 jours |
| Annuler une séance qui a des inscrits | admin, gerant | Réservations libérées, inscrits prévenus |
| Paramètres → Réservations des cours | admin, gerant | Fenêtre d'ouverture et délai d'annulation réglables |

En production, appelez toutes les heures `GET /api/cron/notifications` avec l'en-tête `Authorization: Bearer <CRON_SECRET>` : rappels d'échéance (J-7, J-3, J0) et nouvel essai des e-mails en échec.

## Caisse et dépenses

La caisse ne concerne que les **espèces** : les paiements Mobile Money n'y entrent pas.

| Scénario | Compte | Résultat attendu |
|---|---|---|
| Accueil → « Caisse » → fond de 25 000 → « Ouvrir la caisse » | accueil | Caisse ouverte, fond initial affiché |
| « Encaisser » un abonnement en espèces | accueil | Le paiement apparaît dans les mouvements de la caisse |
| Retrait de 10 000 « Remise en banque » ; puis retrait de 1 000 000 | accueil | Le premier passe ; le second est refusé (« la caisse ne contient que… ») |
| « Compter et clôturer » avec un montant différent du théorique, sans explication | accueil | Refusé : l'écart doit être expliqué |
| Admin → « Caisse » → « Clôtures à valider » → valider | gerant | Caisse validée ; impossible de valider sa propre clôture (sauf l'admin) |
| « Détail » → « Z de caisse (PDF) » | gerant, compta | PDF : synthèse, mouvements, écart, signatures |
| Admin → « Dépenses » → nouvelle dépense en espèces avec photo de la facture | gerant, compta | Dépense au journal avec justificatif ; sortie de caisse si une caisse est ouverte |
| Annuler cette dépense (motif obligatoire) | gerant | Barrée ; le montant revient dans la caisse ouverte (contre-passation) |
| Joindre un fichier texte renommé en .pdf | gerant | Refusé : seul le contenu réel compte |
| Caisse → réglage « Refuser toute opération en espèces… » | gerant | Sans caisse ouverte, l'encaissement en espèces est refusé |

Le comptable consulte caisses, Z et exports mais n'ouvre ni ne clôture la caisse : il contrôle, il n'opère pas.

## WhatsApp, SMS et renouvellement en un clic

Les messages sont **simulés** en local : ils s'affichent dans le terminal de `pnpm dev` (`[whatsapp:dev]`, `[sms:dev]`). Un numéro se terminant par `0000` simule un échec définitif.

| Scénario | Compte | Résultat attendu |
|---|---|---|
| « Messages » → cocher WhatsApp et SMS → Enregistrer | admin | Canaux activés (le gérant voit l'état sans pouvoir le modifier) |
| Fiche d'un adhérent → cocher « WhatsApp », puis annuler une séance où il est inscrit | admin, gerant | Dans la console : `[whatsapp:dev] … zahfit_seance_annulee` ; ligne « Séance annulée » dans « Messages » |
| Adhérent avec SMS seulement | admin | Même scénario : SMS avec un lien `/desinscription/…` |
| Ouvrir le lien de désinscription, « Confirmer la désinscription » | — | « C'est noté » ; case SMS décochée sur la fiche, trace dans l'historique |
| Abonnement qui se termine dans 7 jours, puis `GET /api/cron/notifications` (avec `CRON_SECRET`) | — | Rappel avec un lien `/s/pilote-cocody/renouveler/…` |
| Ouvrir ce lien → « Payer … par Mobile Money » → « Simuler un paiement réussi » | — | « Merci … ! » ; nouvel abonnement à la suite de l'actuel ; le lien affiche ensuite « déjà payé » |
| Tableau de bord Super Admin | superadmin | Tableau « WhatsApp et SMS ce mois-ci » : volumes et coût par salle |

## Inscription et paiement en ligne (sans compte)

Le prestataire est **simulé** (`PAYMENT_PROVIDER="sandbox"`) : aucun argent réel ne circule, et le simulateur est désactivé en production.

| Scénario | Résultat attendu |
|---|---|
| Ouvrir http://localhost:3100/s/pilote-cocody | Vitrine de la salle avec ses formules actives |
| « S'inscrire » sur une formule, remplir le formulaire, accepter les conditions | Redirection vers le simulateur `/paiement-test/SBX-…` |
| « Simuler un paiement réussi » | « Bienvenue … ! », reçu REC-… ; dans la console : e-mail du reçu PDF + lien de création du mot de passe |
| Recommencer et « Simuler un échec » | « Le paiement n'a pas abouti », bouton « Réessayer », aucun abonnement activé |
| Côté salle (accueil ou admin) | L'adhérent apparaît ; le paiement en ligne figure au journal des paiements |
| `curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3100/api/cron/paiements` | Résumé du rapprochement (tentatives expirées après 30 min) |

En local, sans `RESEND_API_KEY`, les e-mails (invitation, mot de passe oublié) ne partent pas : leur lien s'affiche dans le terminal de `pnpm dev`.
