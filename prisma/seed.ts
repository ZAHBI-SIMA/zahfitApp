/**
 * Données de démonstration LOCALES (jamais en production).
 * Lancement : pnpm db:seed — idempotent, peut être relancé sans doublon.
 *
 * Tous les comptes partagent le mot de passe défini par SEED_PASSWORD (.env).
 */
import "dotenv/config";
import { auth } from "@/lib/auth";
import { prisma, withPlatform } from "@/lib/db";
import type { TenantRole } from "@/lib/generated/prisma/enums";

if (process.env.NODE_ENV === "production") {
  throw new Error("Le seed de démonstration ne doit jamais tourner en production.");
}

const PASSWORD = process.env.SEED_PASSWORD;
if (!PASSWORD || PASSWORD.length < 10) {
  throw new Error("Définissez SEED_PASSWORD (10 caractères minimum) dans .env");
}

const TENANTS = [
  { slug: "pilote-cocody", name: "Salle Pilote Cocody", commune: "Cocody", city: "Abidjan" },
  { slug: "demo-plateau", name: "Démo Fitness Plateau", commune: "Plateau", city: "Abidjan" },
] as const;

const ACCOUNTS: { email: string; name: string; tenant?: string; role?: TenantRole; platform?: true }[] = [
  { email: "superadmin@zahfit.local", name: "Équipe ZahDigit", platform: true },
  { email: "admin@pilote.zahfit.local", name: "Awa Koné", tenant: "pilote-cocody", role: "ADMIN" },
  { email: "gerant@pilote.zahfit.local", name: "Yao Kouassi", tenant: "pilote-cocody", role: "MANAGER" },
  { email: "accueil@pilote.zahfit.local", name: "Mariam Traoré", tenant: "pilote-cocody", role: "RECEPTIONIST" },
  { email: "coach@pilote.zahfit.local", name: "Serge Bamba", tenant: "pilote-cocody", role: "COACH" },
  { email: "compta@pilote.zahfit.local", name: "Fatou Diallo", tenant: "pilote-cocody", role: "ACCOUNTANT" },
  { email: "adherent@pilote.zahfit.local", name: "Kevin N'Guessan", tenant: "pilote-cocody", role: "MEMBER" },
  { email: "admin@plateau.zahfit.local", name: "Ibrahim Ouattara", tenant: "demo-plateau", role: "ADMIN" },
];

async function ensureUser(email: string, name: string, platformRole: string | null) {
  const ctx = await auth.$context;
  const existing = await ctx.internalAdapter.findUserByEmail(email);
  if (existing) return existing.user.id;

  const user = await ctx.internalAdapter.createUser(
    {
      email,
      name,
      emailVerified: true, // comptes créés par un administrateur : e-mail réputé vérifié
      platformRole,
    },
    { method: "admin" },
  );
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: await ctx.password.hash(PASSWORD!),
  });
  return user.id;
}

async function main() {
  const superAdminId = await ensureUser(ACCOUNTS[0].email, ACCOUNTS[0].name, "SUPER_ADMIN");

  await withPlatform(superAdminId, async (tx) => {
    const tenantIds = new Map<string, string>();
    for (const t of TENANTS) {
      const tenant = await tx.tenant.upsert({ where: { slug: t.slug }, update: {}, create: t });
      tenantIds.set(t.slug, tenant.id);
    }

    for (const account of ACCOUNTS.slice(1)) {
      const userId = await ensureUser(account.email, account.name, null);
      const tenantId = tenantIds.get(account.tenant!)!;
      await tx.tenantMembership.upsert({
        where: { tenantId_userId: { tenantId, userId } },
        update: { role: account.role! },
        create: { tenantId, userId, role: account.role! },
      });
    }
  });

  console.info(`Seed terminé : ${TENANTS.length} salles, ${ACCOUNTS.length} comptes.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
