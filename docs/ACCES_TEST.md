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

En local, sans `RESEND_API_KEY`, les e-mails (invitation, mot de passe oublié) ne partent pas : leur lien s'affiche dans le terminal de `pnpm dev`.
