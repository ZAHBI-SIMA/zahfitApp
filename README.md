# ZAHFIT

Plateforme SaaS multi-établissements de gestion des salles de sport et centres de fitness — par **ZahDigit** (Côte d'Ivoire, puis Afrique francophone).

Adhérents, abonnements, paiements Mobile Money, contrôle d'accès par QR Code, cours collectifs, notifications WhatsApp et statistiques, avec un espace isolé par salle.

## État d'avancement

| Sprint | Contenu | État |
|---|---|---|
| 1 | Socle : multi-tenant + RLS PostgreSQL, Better Auth (2FA, limitation des tentatives), RBAC, 5 espaces | ✅ |
| 2 | Salles (Super Admin), adhérents (fiche, recherche, archivage, import CSV), équipe, paramètres, journal d'audit | ✅ |
| 3 | Formules, cycle de vie des abonnements (attribution, renouvellement, suspension, prolongation, annulation), encaissement manuel, listes de suivi, tableau de bord | ✅ |
| 4 | Reçus PDF numérotés (envoi par e-mail), paiement partiel avec acompte, soldes impayés, remboursements (avoirs), journal des paiements, export comptable CSV | ✅ |
| 5 | Page publique `/s/[slug]`, inscription en ligne, couche prestataires (simulateur signé), webhooks idempotents, rapprochement planifié | ✅ (agrégateur réel à brancher) |
| 6 | Contrôle d'accès : QR dynamique (30 s, généré sur le téléphone), badges révocables, écran de scan (douchette, caméra), restrictions figées à la vente, quota, anti-passback, journal des passages, fréquentation, mode hors ligne | ✅ |
| 7 | Profils employés (spécialités, disponibilités), types de cours et salles de cours, cours réguliers hebdomadaires (séances générées sur 8 semaines, prolongées chaque jour), exceptions (remplacement, décalage, annulation), conflits coach/salle garantis par la base, planning semaine/jour, espace coach | ✅ |
| 8 | Réservations (fenêtre et délai d'annulation réglables), capacité garantie par la base, liste d'attente avec promotion automatique, inscription par l'accueil, pointage des présences et taux de présence, moteur de notifications (application + e-mail, boîte d'envoi), rappels J-7 / J-3 / J0 | ✅ |
| 9 | WhatsApp Cloud API (modèles « utilitaires », envoi par la boîte d'envoi, statuts de livraison signés), SMS de secours, consentements stricts (réponse STOP, lien de désinscription signé), renouvellement en un clic (lien à usage unique), journal des envois, coût par salle | ✅ (fournisseur SMS réel à brancher) |
| 10 | Dépenses catégorisées avec justificatifs (photo ou PDF, type vérifié), caisse : ouverture avec fond, mouvements automatiques (espèces encaissées, remboursées, dépensées), apports et retraits, clôture avec écart expliqué, validation par le gérant, Z de caisse PDF, exports CSV ; règles garanties par la base (une caisse ouverte, mouvements immuables, théorique recalculé) | ✅ |
| 11 | Boutique : catalogue, stock tenu par la base (réceptions, ajustements, alertes de seuil), vente au comptoir avec ticket PDF numéroté, annulation (remise en stock, contre-passation de caisse) ; espace adhérent enrichi (historique complet, achats, renouvellement en ligne, préférences de contact, coordonnées de la salle) ; statistiques (comparaison de périodes, recettes par formule, panier moyen, cours et produits les plus vendus, cohortes de rétention) | ✅ (paiements directs Orange/MTN/Wave reportés) |
| 12 | Forfaits SaaS Starter / Business / Premium (modules et limites modifiables par le Super Admin) : modules vérifiés côté serveur (actions, pages, parcours publics) et masqués dans le menu ; limites d'adhérents actifs, de comptes d'équipe et de WhatsApp par mois (repli SMS) ; mesure de l'usage par salle ; une salle ne peut pas changer son forfait (garanti par la base) | ✅ (tarifs indicatifs à valider) |
| 13 | Facturation ZahDigit : essai de 30 jours, factures d'installation et mensuelles numérotées sans trou (PDF), paiement Mobile Money par la salle, relances (J-3 à J+15), retard → lecture seule → suspension automatique et réactivation au paiement, tableau de bord MRR / attrition / encours / réussite des paiements ; factures figées et salle en lecture seule garanties par la base | ✅ |
| 14 | Support et onboarding : tickets salle → ZahDigit (statuts, priorité, prise en charge, notes internes invisibles pour la salle, historique immuable, avis par e-mail), joignable même en lecture seule ou suspendue ; assistant de démarrage (infos → formules → adhérents → encaissements → équipe) dont l'avancement se déduit des données ; accès du support « en tant que » un membre du personnel, en consultation seule, 2 h au plus, annoncé aux administrateurs et inscrit dans un historique que la salle consulte et que personne ne peut effacer | ✅ |

## Stack

Next.js 16 (App Router, Cache Components) · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui · PostgreSQL 16+ · Prisma 7 · Better Auth · Zod 4 · Vitest

## Démarrage local

### 1. Prérequis

- Node.js 24+ et pnpm 12+
- PostgreSQL 16+ : **Docker** (option A) ou **installation locale** (option B)

### 2. Installer

```bash
pnpm install
cp .env.example .env    # puis générer BETTER_AUTH_SECRET : openssl rand -base64 32
```

### 3. Base de données

L'application utilise **deux rôles PostgreSQL** :

- `zahfit_owner` : migrations uniquement ;
- `zahfit_app` : l'application, toujours soumise au Row Level Security.

Ne connectez jamais l'application avec un superutilisateur : il ignore le RLS et l'isolation entre salles disparaît.

**Option A — Docker** (port 5442, rôles créés automatiquement) :

```bash
pnpm db:up
```

**Option B — PostgreSQL installé localement** : en tant que `postgres`, exécutez le SQL ci-dessous, puis adaptez les URL de `.env`. Utilisez `127.0.0.1` plutôt que `localhost` si un conteneur occupe aussi le port 5432 en IPv6.

```sql
CREATE ROLE zahfit_owner LOGIN CREATEDB BYPASSRLS PASSWORD 'choisir-un-mot-de-passe';
CREATE ROLE zahfit_app   LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'choisir-un-autre-mot-de-passe';
CREATE DATABASE zahfit      OWNER zahfit_owner;
CREATE DATABASE zahfit_test OWNER zahfit_owner;
GRANT CONNECT ON DATABASE zahfit, zahfit_test TO zahfit_app;
```

Puis, dans les deux cas :

```bash
pnpm db:deploy     # applique les migrations (schéma + politiques RLS)
pnpm db:seed       # 2 salles et 8 comptes de démonstration
pnpm dev           # http://localhost:3100
```

### 4. Comptes de test

Voir **[docs/ACCES_TEST.md](docs/ACCES_TEST.md)**.

## Commandes

| Commande | Rôle |
|---|---|
| `pnpm dev` | Serveur de développement (port 3100) |
| `pnpm test` | Tests unitaires et d'intégration (base `zahfit_test`) |
| `pnpm lint` / `pnpm typecheck` | Qualité du code |
| `pnpm build` | Build de production |
| `pnpm db:migrate` | Créer une migration (développement) |
| `pnpm db:deploy` | Appliquer les migrations |
| `pnpm db:seed` | Données de démonstration (refusé en production) |

## Architecture

```
app/            routes : (auth), super-admin, admin, reception, coach, member, api
components/     interface (shell, formulaires, adhérents, équipe, salles, ui shadcn)
modules/        métier par domaine : *.schema.ts (Zod), *.service.ts, *.actions.ts
lib/            db (contexte RLS), auth, session, rbac, audit, validation, téléphone, CSV
prisma/         schéma, migrations (dont les politiques RLS), seed
tests/          unit/ et integration/ (isolation multi-tenant, adhérents, équipe)
```

### Principes de sécurité

- **Isolation multi-tenant par PostgreSQL** : toute requête métier passe par `withTenant()` ([lib/db.ts](lib/db.ts)), qui pose `app.tenant_id` dans la transaction. Les politiques RLS refusent tout le reste, même si le code oublie un filtre.
- **RBAC** : la matrice rôle → permissions ([lib/rbac/permissions.ts](lib/rbac/permissions.ts)) est revérifiée côté serveur dans chaque Server Action.
- **2FA obligatoire** pour les comptes qui gèrent le personnel, la facturation ou les remboursements.
- **Journal d'audit en ajout seul** : le rôle applicatif n'a pas le droit `UPDATE` ni `DELETE` sur `audit_logs`.
- **Données de santé exclues** : la fiche adhérent n'a pas de champ de notes libres (loi ivoirienne n° 2013-450).
