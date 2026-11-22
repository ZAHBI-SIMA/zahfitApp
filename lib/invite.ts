import "server-only";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * Comptes créés par un administrateur (personnel, administrateur de salle).
 *
 * Aucun mot de passe temporaire : on crée l'utilisateur sans mot de passe,
 * puis on lui envoie le lien « choisir mon mot de passe » de Better Auth,
 * qui crée le compte de connexion au premier usage. Personne d'autre que
 * l'intéressé ne connaît jamais son mot de passe.
 */
export async function findOrCreateUser(email: string, name: string): Promise<{ id: string; isNew: boolean }> {
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return { id: existing.id, isNew: false };

  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser(
    { email, name, emailVerified: true }, // e-mail fourni par un administrateur
    { method: "admin" },
  );
  return { id: user.id, isNew: true };
}

/** Envoie le lien d'activation si le compte n'a pas encore de mot de passe. */
export async function sendActivationLinkIfNeeded(userId: string, email: string): Promise<boolean> {
  const hasPassword = await prisma.account.count({
    where: { userId, providerId: "credential", password: { not: null } },
  });
  if (hasPassword > 0) return false;

  await auth.api.requestPasswordReset({
    body: { email, redirectTo: "/reinitialiser-mot-de-passe" },
  });
  return true;
}
