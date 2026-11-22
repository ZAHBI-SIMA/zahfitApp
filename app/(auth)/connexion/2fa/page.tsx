import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { VerifyTwoFactorForm } from "./verify-form";

export const metadata: Metadata = { title: "Vérification en deux étapes" };

export default function VerifyTwoFactorPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Vérification en deux étapes</CardTitle>
        <CardDescription>
          Saisissez le code à 6 chiffres affiché dans votre application d&apos;authentification.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <VerifyTwoFactorForm />
      </CardContent>
    </Card>
  );
}
