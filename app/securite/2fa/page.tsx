import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/session";
import { Logo } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SetupTwoFactor } from "./setup-form";

export const metadata: Metadata = { title: "Double authentification" };

export default function SecuriteTwoFactorPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 bg-muted px-4 py-12">
      <Logo className="text-primary dark:text-foreground" />
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Double authentification</CardTitle>
          <CardDescription>
            Obligatoire pour les comptes qui gèrent l&apos;argent ou le personnel de la salle.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<p className="text-sm text-muted-foreground">Chargement…</p>}>
            <TwoFactorState />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}

async function TwoFactorState() {
  const user = await requireUser();
  if (user.twoFactorEnabled) {
    return (
      <div className="flex flex-col gap-4 text-sm">
        <p>La double authentification est activée sur votre compte.</p>
        <Button nativeButton={false} render={<Link href="/espace" />}>Continuer</Button>
      </div>
    );
  }
  return <SetupTwoFactor />;
}
