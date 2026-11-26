import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Check } from "lucide-react";
import { ImportMembersForm } from "@/components/members/import-form";
import { FinishOnboardingButton, SkipStepButton } from "@/components/onboarding/onboarding-forms";
import { BillingSettingsForm } from "@/components/payments/payment-forms";
import { PlanForm } from "@/components/plans/plan-form";
import { PageHeader } from "@/components/shell/page-header";
import { InviteStaffForm } from "@/components/staff/staff-forms";
import { TenantSettingsForm } from "@/components/tenants/tenant-forms";
import { withTenant } from "@/lib/db";
import { formatDuration, ROLE_LABELS } from "@/lib/labels";
import { formatXof } from "@/lib/format";
import { can } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";
import { cn } from "@/lib/utils";
import { isStepKey, onboardingState, type OnboardingStepKey } from "@/modules/onboarding/onboarding.service";
import { readOpeningHours, readSocials } from "@/modules/tenants/tenants.schema";

export const metadata: Metadata = { title: "Mise en route" };

/**
 * Assistant de démarrage : chaque étape réutilise le formulaire de la page
 * correspondante (paramètres, formules, import, encaissements, équipe), si
 * bien qu'un réglage fait ici ou depuis le menu est le même réglage.
 */
export default async function OnboardingPage({ searchParams }: PageProps<"/admin/demarrage">) {
  const ctx = await requireSpace("admin");
  if (!can(ctx.role, "staff.manage")) redirect("/admin");
  const params = await searchParams;

  const data = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => ({
    state: await onboardingState(tx, ctx.tenant.id),
    tenant: await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenant.id } }),
    plans: await tx.membershipPlan.findMany({
      where: { isActive: true },
      orderBy: { priceXof: "asc" },
      select: { id: true, name: true, priceXof: true, durationValue: true, durationUnit: true },
    }),
    staff: await tx.tenantMembership.findMany({
      where: { role: { not: "MEMBER" } },
      orderBy: { createdAt: "asc" },
      select: { id: true, role: true, status: true, user: { select: { name: true, email: true } } },
    }),
  }));
  const { state, tenant, plans, staff } = data;

  const current: OnboardingStepKey = isStepKey(params.etape) ? params.etape : (state.next ?? "salle");
  const index = state.steps.findIndex((s) => s.key === current);
  const step = state.steps[index];
  const nextStep = state.steps[index + 1];

  return (
    <>
      <PageHeader
        title="Mise en route de votre salle"
        description={`${state.settled} étape(s) sur ${state.total} — vous pouvez quitter et reprendre à tout moment.`}
      />
      {state.doneAt && (
        <p role="status" className="mb-4 rounded-lg border border-brand/40 bg-brand/10 px-4 py-3 text-sm">
          Mise en route terminée. Ces réglages restent modifiables depuis le menu.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <nav aria-label="Étapes">
          <ol className="flex flex-col gap-1">
            {state.steps.map((s, i) => (
              <li key={s.key}>
                <Link
                  href={`/admin/demarrage?etape=${s.key}`}
                  aria-current={s.key === current ? "step" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm",
                    s.key === current ? "bg-muted font-medium" : "hover:bg-muted/60",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs",
                      s.done && "border-brand bg-brand text-brand-foreground",
                    )}
                    aria-hidden
                  >
                    {s.done ? <Check className="size-3.5" /> : i + 1}
                  </span>
                  <span className="flex-1">{s.label}</span>
                  {s.skipped && <span className="text-xs text-muted-foreground">passée</span>}
                </Link>
              </li>
            ))}
          </ol>
        </nav>

        <section aria-labelledby="etape" className="rounded-xl border bg-card p-5">
          <h2 id="etape" className="text-base font-medium">
            {index + 1}. {step.label} {step.done && <span className="text-sm font-normal text-brand">— fait</span>}
          </h2>
          <p className="mb-5 text-sm text-muted-foreground">{step.hint}</p>

          {current === "salle" && (
            <TenantSettingsForm
              tenant={tenant}
              description={tenant.description}
              hours={readOpeningHours(tenant.openingHours)}
              socials={readSocials(tenant.socials)}
            />
          )}

          {current === "formules" && (
            <div className="flex flex-col gap-6">
              {params.cree === "1" && (
                <p role="status" className="rounded-lg border border-brand/40 bg-brand/10 px-4 py-3 text-sm">
                  Formule créée. Ajoutez-en d&apos;autres ou passez à l&apos;étape suivante.
                </p>
              )}
              {plans.length > 0 && (
                <ul className="flex flex-wrap gap-2 text-sm">
                  {plans.map((p) => (
                    <li key={p.id} className="rounded-lg border px-3 py-1.5">
                      {p.name} · {formatXof(p.priceXof)} · {formatDuration(p.durationValue, p.durationUnit)}
                    </li>
                  ))}
                </ul>
              )}
              <PlanForm returnTo="/admin/demarrage" />
            </div>
          )}

          {current === "adherents" && (
            <div className="flex flex-col gap-4">
              <p className="text-sm">
                {state.facts.members > 0
                  ? `${state.facts.members} adhérent(s) inscrit(s).`
                  : "Aucun adhérent pour le moment."}{" "}
                <Link href="/admin/adherents/nouveau" className="text-brand hover:underline">
                  Inscrire un adhérent
                </Link>{" "}
                ou importez votre fichier (Excel enregistré en CSV) :
              </p>
              <ImportMembersForm />
            </div>
          )}

          {current === "encaissements" && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">
                Espèces, Mobile Money et carte sont acceptés à l&apos;accueil ; le paiement en ligne des adhérents passe par
                l&apos;agrégateur de ZahDigit, sans réglage de votre part. Indiquez ici vos conditions et la mention de vos
                reçus (RCCM, compte contribuable).
              </p>
              <BillingSettingsForm
                settings={{
                  allowPartialPayment: tenant.allowPartialPayment,
                  minDepositPercent: tenant.minDepositPercent,
                  receiptFooter: tenant.receiptFooter,
                }}
              />
            </div>
          )}

          {current === "equipe" && (
            <div className="flex flex-col gap-5">
              <ul className="flex flex-col gap-1 text-sm">
                {staff.map((s) => (
                  <li key={s.id}>
                    <span className="font-medium">{s.user.name}</span>{" "}
                    <span className="text-muted-foreground">
                      — {ROLE_LABELS[s.role]} · {s.user.email}
                      {s.status !== "ACTIVE" && " · désactivé"}
                    </span>
                  </li>
                ))}
              </ul>
              <InviteStaffForm />
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3 border-t pt-4">
            {nextStep ? (
              <Link
                href={`/admin/demarrage?etape=${nextStep.key}`}
                className="inline-flex h-8 items-center rounded-lg bg-brand px-3 text-sm font-medium text-brand-foreground"
              >
                Étape suivante : {nextStep.label} →
              </Link>
            ) : (
              !state.doneAt && <FinishOnboardingButton ready={state.next === null} />
            )}
            {/* Sans formule, rien ne peut être vendu : cette étape ne se passe pas. */}
            {!step.done && !step.skipped && current !== "formules" && <SkipStepButton step={current} />}
          </div>
        </section>
      </div>
    </>
  );
}
