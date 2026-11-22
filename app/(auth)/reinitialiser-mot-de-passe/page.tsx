import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ResetPasswordForm } from "./reset-form";

export const metadata: Metadata = { title: "Nouveau mot de passe" };

export default function ReinitialiserPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Nouveau mot de passe</CardTitle>
        <CardDescription>Au moins 10 caractères.</CardDescription>
      </CardHeader>
      <CardContent>
        {/* useSearchParams() lit l'URL de la requête : frontière Suspense requise */}
        <Suspense>
          <ResetPasswordForm />
        </Suspense>
      </CardContent>
    </Card>
  );
}
