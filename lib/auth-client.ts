"use client";

import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [
    twoFactorClient({
      // Mot de passe correct mais 2FA activée → étape de saisie du code.
      onTwoFactorRedirect() {
        // Callback de module (hors composant) : pas d'accès à useRouter ici.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = "/connexion/2fa";
      },
    }),
  ],
});
