import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { audit } from "@/lib/audit";
import { prisma, withUser } from "@/lib/db";
import { sendMail } from "@/lib/mail";

/**
 * Authentification ZAHFIT (Better Auth).
 *
 * Choix du Sprint 1 :
 * - Pas d'inscription publique : les comptes du personnel sont créés par un
 *   administrateur (Sprint 2) ou par le seed. L'inscription des adhérents en
 *   ligne arrive au Sprint 5.
 * - Mots de passe hachés en scrypt par Better Auth (section 9).
 * - 2FA TOTP disponible pour tous, OBLIGATOIRE pour les rôles sensibles
 *   (contrôlé dans lib/session.ts).
 * - Limitation des tentatives stockée en base (fonctionne en serverless).
 */
export const auth = betterAuth({
  appName: "ZAHFIT",
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, { provider: "postgresql" }),

  user: {
    additionalFields: {
      // input: false → impossible à définir depuis une requête client.
      platformRole: { type: "string", required: false, input: false },
    },
  },

  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 10,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    // 24 h : le même lien sert aux invitations du personnel (lib/invite.ts),
    // qui ne sont pas toujours ouvertes dans l'heure.
    resetPasswordTokenExpiresIn: 60 * 60 * 24,
    sendResetPassword: async ({ user, url }) => {
      await sendMail({
        to: user.email,
        subject: "ZAHFIT — Choisissez votre mot de passe",
        text: `Bonjour ${user.name}, pour choisir votre mot de passe ZAHFIT : ${url} (lien valable 24 heures, utilisable une seule fois).`,
        html: `<p>Bonjour ${escapeHtml(user.name)},</p><p><a href="${url}">Choisir mon mot de passe ZAHFIT</a></p><p>Lien valable 24 heures, utilisable une seule fois. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.</p>`,
      });
    },
  },

  emailVerification: {
    sendOnSignIn: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendMail({
        to: user.email,
        subject: "ZAHFIT — Confirmez votre adresse e-mail",
        text: `Bonjour ${user.name}, confirmez votre adresse : ${url}`,
        html: `<p>Bonjour ${escapeHtml(user.name)},</p><p><a href="${url}">Confirmer mon adresse e-mail</a></p>`,
      });
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 jours
    updateAge: 60 * 60 * 24, // prolongée au plus une fois par jour
  },

  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/two-factor/verify-totp": { window: 60, max: 5 },
      "/two-factor/verify-backup-code": { window: 60, max: 5 },
      "/request-password-reset": { window: 300, max: 3 },
    },
  },

  databaseHooks: {
    session: {
      create: {
        after: async (session) => {
          // Connexion réussie → événement plateforme (tenant_id NULL).
          await withUser(session.userId, (tx) =>
            audit(tx, {
              actorUserId: session.userId,
              action: "auth.login",
              entityType: "session",
              entityId: session.id,
              ipAddress: session.ipAddress,
              userAgent: session.userAgent,
            }),
          );
        },
      },
    },
  },

  plugins: [
    twoFactor({ issuer: "ZAHFIT" }),
    nextCookies(), // doit rester le DERNIER plugin
  ],
});

export type AuthSession = typeof auth.$Infer.Session;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
