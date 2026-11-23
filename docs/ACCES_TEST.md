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
