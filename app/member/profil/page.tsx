import type { Metadata } from "next";
import { ConsentsForm } from "@/components/members/member-space-forms";
import { PageHeader } from "@/components/shell/page-header";
import { withTenant } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { requireSpace } from "@/lib/session";
import { myMember } from "@/modules/members/member-space.service";
import { DAYS, DAY_LABELS, readOpeningHours, readSocials } from "@/modules/tenants/tenants.schema";

export const metadata: Metadata = { title: "Mon profil" };

const SOCIAL_LABELS = { facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok", website: "Site web" } as const;

export default async function MemberProfilePage() {
  const ctx = await requireSpace("member");
  const data = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => ({
    member: await myMember(tx, ctx.user.id),
    tenant: await tx.tenant.findUniqueOrThrow({
      where: { id: ctx.tenant.id },
      select: {
        name: true,
        phone: true,
        email: true,
        address: true,
        commune: true,
        city: true,
        openingHours: true,
        socials: true,
      },
    }),
  }));
  const { member, tenant } = data;
  const hours = tenant.openingHours ? readOpeningHours(tenant.openingHours) : null;
  const socials = Object.entries(readSocials(tenant.socials)) as [keyof typeof SOCIAL_LABELS, string][];
  const whatsapp = tenant.phone ? `https://wa.me/${tenant.phone.replace(/\D/g, "")}` : null;
  const section = "rounded-xl border bg-card p-5";

  return (
    <>
      <PageHeader title="Mon profil" description="Vos informations, vos préférences de contact et la salle." />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          {member && (
            <section className={section} aria-labelledby="infos">
              <h2 id="infos" className="mb-3 text-sm font-medium">
                Mes informations
              </h2>
              <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
                <dt className="text-muted-foreground">N° adhérent</dt>
                <dd className="font-mono">{member.code}</dd>
                <dt className="text-muted-foreground">Nom</dt>
                <dd>
                  {member.lastName} {member.firstName}
                </dd>
                <dt className="text-muted-foreground">Téléphone</dt>
                <dd>{formatPhone(member.phone)}</dd>
                <dt className="text-muted-foreground">E-mail</dt>
                <dd>{member.email ?? "—"}</dd>
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">Une correction ? Demandez-la à l&apos;accueil.</p>
            </section>
          )}
          {member && (
            <section className={section} aria-labelledby="preferences">
              <h2 id="preferences" className="mb-1 text-sm font-medium">
                Messages de la salle
              </h2>
              <p className="mb-4 text-xs text-muted-foreground">
                Vous choisissez les canaux sur lesquels la salle peut vous écrire. Vous pouvez aussi répondre STOP à
                tout message.
              </p>
              <ConsentsForm
                consents={{
                  consentWhatsapp: member.consentWhatsapp,
                  consentSms: member.consentSms,
                  consentEmail: member.consentEmail,
                }}
              />
            </section>
          )}
        </div>

        <section className={section} aria-labelledby="contact">
          <h2 id="contact" className="mb-3 text-sm font-medium">
            Contacter {tenant.name}
          </h2>
          <ul className="flex flex-col gap-2 text-sm">
            {tenant.phone && (
              <li>
                <a href={`tel:${tenant.phone}`} className="text-brand hover:underline">
                  {formatPhone(tenant.phone)}
                </a>
                {whatsapp && (
                  <>
                    {" · "}
                    <a href={whatsapp} target="_blank" rel="noopener" className="text-brand hover:underline">
                      WhatsApp
                    </a>
                  </>
                )}
              </li>
            )}
            {tenant.email && (
              <li>
                <a href={`mailto:${tenant.email}`} className="text-brand hover:underline">
                  {tenant.email}
                </a>
              </li>
            )}
            {(tenant.address || tenant.city) && (
              <li className="text-muted-foreground">
                {[tenant.address, tenant.commune, tenant.city].filter(Boolean).join(", ")}
              </li>
            )}
            {socials.map(([key, url]) => (
              <li key={key}>
                <a href={url} target="_blank" rel="noopener" className="text-brand hover:underline">
                  {SOCIAL_LABELS[key]}
                </a>
              </li>
            ))}
          </ul>
          {hours && (
            <>
              <h3 className="mt-5 mb-2 text-sm font-medium">Horaires</h3>
              <dl className="grid grid-cols-[110px_1fr] gap-y-1 text-sm">
                {DAYS.map((d) => (
                  <div key={d} className="contents">
                    <dt className="text-muted-foreground">{DAY_LABELS[d]}</dt>
                    <dd>{hours[d] ? hours[d]!.replace("-", " – ") : "Fermé"}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </section>
      </div>
    </>
  );
}
