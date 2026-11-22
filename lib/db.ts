import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Accès base de données ZAHFIT.
 *
 * `prisma` se connecte avec le rôle `zahfit_app`, soumis au RLS. Utilisé SEUL
 * (sans contexte), il ne voit AUCUNE ligne des tables multi-tenant : c'est
 * voulu. Pour lire/écrire des données métier, passer par `withTenant`,
 * `withUser` ou `withPlatform`, qui posent le contexte dans une transaction.
 *
 * Seules les tables d'identité (users, sessions…) sont accessibles sans
 * contexte, car Better Auth les gère lui-même.
 */

export type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;

export type DbContext = {
  tenantId?: string | null;
  userId?: string | null;
  platform?: boolean;
};

export function createPrismaClient(connectionString: string) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

const globalForPrisma = globalThis as unknown as { zahfitPrisma?: PrismaClient };

export const prisma =
  globalForPrisma.zahfitPrisma ?? createPrismaClient(requireEnv("DATABASE_URL"));

if (process.env.NODE_ENV !== "production") globalForPrisma.zahfitPrisma = prisma;

/**
 * Exécute `fn` dans une transaction où le contexte RLS est posé.
 * `set_config(..., true)` = portée LOCALE à la transaction : impossible qu'il
 * « fuie » vers une autre requête qui réutiliserait la même connexion du pool.
 */
export async function withDbContext<T>(
  ctx: DbContext,
  fn: (tx: Tx) => Promise<T>,
  client: PrismaClient = prisma,
): Promise<T> {
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT
        set_config('app.tenant_id',   ${ctx.tenantId ?? ""}, true),
        set_config('app.user_id',     ${ctx.userId ?? ""}, true),
        set_config('app.is_platform', ${ctx.platform ? "on" : "off"}, true)`;
    return fn(tx);
  });
}

/** Données d'UNE salle, pour l'utilisateur connecté. Cas le plus courant. */
export function withTenant<T>(
  tenantId: string,
  userId: string,
  fn: (tx: Tx) => Promise<T>,
  client?: PrismaClient,
) {
  return withDbContext({ tenantId, userId }, fn, client);
}

/** Avant le choix d'une salle : l'utilisateur ne voit que SES appartenances. */
export function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>, client?: PrismaClient) {
  return withDbContext({ userId }, fn, client);
}

/**
 * Super Admin ZahDigit : lecture/écriture toutes salles.
 * À n'appeler qu'APRÈS avoir vérifié `user.platformRole === "SUPER_ADMIN"`.
 */
export function withPlatform<T>(userId: string, fn: (tx: Tx) => Promise<T>, client?: PrismaClient) {
  return withDbContext({ userId, platform: true }, fn, client);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}
