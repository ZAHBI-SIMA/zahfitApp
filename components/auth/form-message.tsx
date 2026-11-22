import { Alert, AlertDescription } from "@/components/ui/alert";

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

/**
 * Traduit les erreurs Better Auth en messages français.
 * Volontairement vague sur les identifiants : on ne révèle jamais si un
 * e-mail existe ou non (anti-énumération des comptes).
 */
export function authErrorMessage(error: { status?: number; code?: string } | null): string {
  if (!error) return "Une erreur est survenue. Réessayez.";
  if (error.status === 429) return "Trop de tentatives. Patientez une minute avant de réessayer.";
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "E-mail ou mot de passe incorrect.";
    case "EMAIL_NOT_VERIFIED":
      return "Adresse e-mail non confirmée : un nouveau lien de confirmation vient de vous être envoyé.";
    case "INVALID_CODE":
    case "INVALID_TWO_FACTOR_CODE":
      return "Code incorrect ou expiré.";
    case "INVALID_PASSWORD":
      return "Mot de passe incorrect.";
    case "PASSWORD_TOO_SHORT":
      return "Le mot de passe doit contenir au moins 10 caractères.";
    case "INVALID_TOKEN":
      return "Lien invalide ou expiré. Refaites une demande de réinitialisation.";
    default:
      return "Une erreur est survenue. Réessayez.";
  }
}
