/**
 * Données de démonstration LOCALES (jamais en production).
 * Lancement : pnpm db:seed — idempotent, peut être relancé sans doublon.
 *
 * Tous les comptes partagent le mot de passe défini par SEED_PASSWORD (.env).
 */
import "dotenv/config";
import { auth } from "@/lib/auth";
import { prisma, withPlatform, withTenant } from "@/lib/db";
import type { TenantRole } from "@/lib/generated/prisma/enums";
import { createMember } from "@/modules/members/members.service";
import { createPlan } from "@/modules/plans/plans.service";
import { addDays, todayCalendar } from "@/modules/subscriptions/dates";
import { assignSubscription, recordManualPayment } from "@/modules/subscriptions/subscriptions.service";

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

/**
 * Formules types (prix de DÉMONSTRATION, à ajuster par la salle) et un
 * abonnement mensuel payé pour le compte adhérent de démo.
 */
async function seedPiloteCatalog() {
  const ctx = await auth.$context;
  const admin = await ctx.internalAdapter.findUserByEmail("admin@pilote.zahfit.local");
  const adherent = await ctx.internalAdapter.findUserByEmail("adherent@pilote.zahfit.local");
  if (!admin || !adherent) return;
  const adminId = admin.user.id;

  const tenant = await withPlatform(adminId, (tx) => tx.tenant.findUnique({ where: { slug: "pilote-cocody" } }));
  if (!tenant) return;
  const actor = { tenantId: tenant.id, userId: adminId };

  await withTenant(tenant.id, adminId, async (tx) => {
    if ((await tx.membershipPlan.count()) > 0) return; // déjà initialisé

    const plan = (name: string, priceXof: number, durationValue: number, durationUnit: "DAY" | "WEEK" | "MONTH" | "YEAR", extra = {}) =>
      createPlan(tx, actor, {
        name,
        description: null,
        priceXof,
        durationValue,
        durationUnit,
        benefits: ["Accès musculation et cardio"],
        allowedDays: [],
        accessFrom: null,
        accessUntil: null,
        maxEntries: null,
        maxFreezeDays: 0,
        isActive: true,
        ...extra,
      });

    await plan("Séance journalière", 2_000, 1, "DAY");
    await plan("Hebdomadaire", 7_000, 1, "WEEK");
    const monthly = await plan("Mensuel", 20_000, 1, "MONTH", {
      maxFreezeDays: 7,
      benefits: ["Accès musculation et cardio", "Cours collectifs inclus"],
    });
    await plan("Trimestriel", 55_000, 3, "MONTH", { maxFreezeDays: 15 });
    await plan("Annuel", 180_000, 1, "YEAR", { maxFreezeDays: 30, benefits: ["Accès illimité", "Cours collectifs inclus", "Bilan forme offert"] });
    await plan("Étudiant", 15_000, 1, "MONTH", {
      allowedDays: [1, 2, 3, 4, 5],
      accessFrom: "06:00",
      accessUntil: "16:00",
      benefits: ["Sur présentation de la carte étudiant", "Du lundi au vendredi, 6 h – 16 h"],
    });

    // Fiche adhérent liée au compte de démo, avec un abonnement en cours payé.
    const member = await createMember(tx, actor, {
      firstName: "Kevin",
      lastName: "N'Guessan",
      phone: "+2250700000099",
      email: "adherent@pilote.zahfit.local",
      birthDate: null,
      consentWhatsapp: true,
      consentSms: false,
      consentEmail: true,
    });
    await tx.member.update({ where: { id: member.id }, data: { userId: adherent.user.id } });
    const today = todayCalendar();
    const sub = await assignSubscription(tx, actor, { memberId: member.id, planId: monthly.id, startDate: addDays(today, -5) }, today);
    await recordManualPayment(tx, actor, sub.id, { method: "CASH", providerRef: null });
  });
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

  await seedPiloteCatalog();
  console.info(`Seed terminé : ${TENANTS.length} salles, ${ACCOUNTS.length} comptes, formules de démonstration.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
