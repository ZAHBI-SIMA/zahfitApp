import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import * as z from "zod";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { withTenant } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/format";
import { MEMBER_SOURCE_LABELS, MEMBER_STATUS_LABELS } from "@/lib/labels";
import { formatPhone } from "@/lib/phone";
import { can, type Permission } from "@/lib/rbac/permissions";
import { requireSpace } from "@/lib/session";
import { cn } from "@/lib/utils";
import { auditLabel } from "@/modules/audit/audit.service";
import type { MemberBasePath } from "@/modules/members/members.schema";
import {
  getMember,
  getMemberHistory,
  parseMemberFilter,
  searchMembers,
  type MemberFilter,
} from "@/modules/members/members.service";
import { ArchiveMemberButton } from "@/components/members/archive-button";
import { MemberForm } from "@/components/members/member-form";
import { SubscriptionPanel } from "@/components/subscriptions/subscription-panel";

/**
 * Pages adhérents partagées par l'Administration et la Réception : même
 * code, droits différents (la matrice RBAC décide de ce qui s'affiche).
 */
export type MemberSpace = "admin" | "reception";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const BASE: Record<MemberSpace, MemberBasePath> = {
  admin: "/admin/adherents",
  reception: "/reception/adherents",
};

async function requireMemberAccess(space: MemberSpace, permission: Permission) {
  const ctx = await requireSpace(space);
  if (!can(ctx.role, permission)) redirect(`/${space}`);
  return ctx;
}

const FILTERS: { value: MemberFilter; label: string }[] = [
  { value: "actifs", label: "En cours" },
  { value: "archives", label: "Archivés" },
  { value: "tous", label: "Tous" },
];

function listHref(base: string, params: { q?: string; filtre?: MemberFilter; page?: number }) {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.filtre && params.filtre !== "actifs") search.set("filtre", params.filtre);
  if (params.page && params.page > 1) search.set("page", String(params.page));
  const qs = search.toString();
  return qs ? `${base}?${qs}` : base;
}

const statusVariant = (status: string) =>
  status === "ACTIVE" ? "secondary" : status === "ARCHIVED" ? "outline" : "destructive";

export async function MembersIndex({ space, searchParams }: { space: MemberSpace; searchParams: SearchParams }) {
  const ctx = await requireMemberAccess(space, "members.read");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : "";
  const filter = parseMemberFilter(sp.filtre);
  const page = Math.max(1, Number(sp.page) || 1);
  const base = BASE[space];

  const result = await withTenant(ctx.tenant.id, ctx.user.id, (tx) => searchMembers(tx, { q, filter, page }));
  const canWrite = can(ctx.role, "members.write");

  return (
    <>
      <PageHeader title="Adhérents" description={`${result.total} adhérent(s)`}>
        <div className="flex gap-2">
          {canWrite && space === "admin" && (
            <Button nativeButton={false} variant="outline" render={<Link href={`${base}/import`} />}>
              Importer
            </Button>
          )}
          {canWrite && (
            <Button nativeButton={false} render={<Link href={`${base}/nouveau`} />}>
              Nouvel adhérent
            </Button>
          )}
        </div>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form role="search" className="flex flex-1 gap-2" action={base}>
          <Input
            name="q"
            defaultValue={q}
            placeholder="Nom, téléphone, code ADH-…"
            aria-label="Rechercher un adhérent"
            className="max-w-sm"
          />
          {filter !== "actifs" && <input type="hidden" name="filtre" value={filter} />}
          <Button type="submit" variant="secondary">
            Rechercher
          </Button>
        </form>
        <nav aria-label="Filtrer" className="flex gap-1 rounded-lg bg-muted p-1 text-sm">
          {FILTERS.map((f) => (
            <Link
              key={f.value}
              href={listHref(base, { q, filtre: f.value })}
              aria-current={filter === f.value ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1",
                filter === f.value ? "bg-background font-medium shadow-sm" : "text-muted-foreground",
              )}
            >
              {f.label}
            </Link>
          ))}
        </nav>
      </div>

      {result.items.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          {q ? `Aucun adhérent ne correspond à « ${q} ».` : "Aucun adhérent pour le moment."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Adhérent</th>
                <th className="px-4 py-3 font-medium">Téléphone</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">E-mail</th>
                <th className="hidden px-4 py-3 font-medium sm:table-cell">Inscrit le</th>
                <th className="px-4 py-3 font-medium">Statut</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((m) => (
                <tr key={m.id} className="border-b last:border-0 hover:bg-muted/50">
                  <td className="px-4 py-3">
                    <Link href={`${base}/${m.id}`} className="font-medium hover:underline">
                      {m.lastName} {m.firstName}
                    </Link>
                    <p className="text-xs text-muted-foreground">{m.code}</p>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatPhone(m.phone)}</td>
                  <td className="hidden px-4 py-3 md:table-cell">{m.email ?? "—"}</td>
                  <td className="hidden px-4 py-3 sm:table-cell">{formatDate(m.createdAt)}</td>
                  <td className="px-4 py-3">
                    <Badge variant={statusVariant(m.status)}>{MEMBER_STATUS_LABELS[m.status]}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result.pageCount > 1 && (
        <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {result.page} / {result.pageCount}
          </span>
          <div className="flex gap-2">
            {result.page > 1 && (
              <Button nativeButton={false} variant="outline" size="sm" render={<Link href={listHref(base, { q, filtre: filter, page: result.page - 1 })} />}>
                Précédente
              </Button>
            )}
            {result.page < result.pageCount && (
              <Button nativeButton={false} variant="outline" size="sm" render={<Link href={listHref(base, { q, filtre: filter, page: result.page + 1 })} />}>
                Suivante
              </Button>
            )}
          </div>
        </nav>
      )}
    </>
  );
}

export async function NewMember({ space }: { space: MemberSpace }) {
  await requireMemberAccess(space, "members.write");
  return (
    <>
      <PageHeader title="Nouvel adhérent" description="Inscription à l'accueil. Les champs marqués * sont obligatoires." />
      <div className="max-w-3xl rounded-xl border bg-card p-5">
        <MemberForm basePath={BASE[space]} />
      </div>
    </>
  );
}

export async function MemberDetail({
  space,
  params,
  searchParams,
}: {
  space: MemberSpace;
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const ctx = await requireMemberAccess(space, "members.read");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const created = (await searchParams).cree === "1";
  const showHistory = can(ctx.role, "audit.read");

  const data = await withTenant(ctx.tenant.id, ctx.user.id, async (tx) => {
    const member = await getMember(tx, id);
    return { member, history: member && showHistory ? await getMemberHistory(tx, id) : [] };
  });
  // Un identifiant d'une AUTRE salle renvoie null grâce au RLS : simple 404.
  if (!data.member) notFound();
  const m = data.member;
  const archived = m.status === "ARCHIVED";

  return (
    <>
      <PageHeader title={`${m.lastName} ${m.firstName}`} description={m.code}>
        <Badge variant={statusVariant(m.status)}>{MEMBER_STATUS_LABELS[m.status]}</Badge>
      </PageHeader>

      {created && (
        <p role="status" className="mb-4 rounded-lg border border-brand/40 bg-brand/10 px-4 py-3 text-sm">
          Adhérent inscrit avec le code <strong>{m.code}</strong>. Attribuez-lui maintenant une formule
          d&apos;abonnement ci-dessous.
        </p>
      )}

      <div className="mb-6">
        <SubscriptionPanel ctx={ctx} memberId={m.id} archived={archived} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <section className="rounded-xl border bg-card p-5" aria-labelledby="identite">
          <h2 id="identite" className="mb-4 text-sm font-medium">
            Identité et contact
          </h2>
          <MemberForm basePath={BASE[space]} member={m} readOnly={archived || !can(ctx.role, "members.write")} />
        </section>

        <aside className="flex flex-col gap-4">
          <div className="rounded-xl border bg-card p-4 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
              <dt className="text-muted-foreground">Inscription</dt>
              <dd>{formatDate(m.createdAt)}</dd>
              <dt className="text-muted-foreground">Origine</dt>
              <dd>{MEMBER_SOURCE_LABELS[m.source]}</dd>
              <dt className="text-muted-foreground">Consentements</dt>
              <dd>{m.consentUpdatedAt ? `mis à jour le ${formatDate(m.consentUpdatedAt)}` : "jamais recueillis"}</dd>
              {m.archivedAt && (
                <>
                  <dt className="text-muted-foreground">Archivé le</dt>
                  <dd>{formatDate(m.archivedAt)}</dd>
                </>
              )}
            </dl>
          </div>

          <div className="rounded-xl border bg-card p-4 text-sm">
            <h2 className="mb-2 font-medium">Bientôt sur cette fiche</h2>
            <ul className="space-y-1 text-muted-foreground">
              <li>Reçus PDF et paiement partiel — Sprint 4</li>
              <li>Entrées (QR Code) — Sprint 6</li>
            </ul>
          </div>

          {can(ctx.role, "members.archive") && <ArchiveMemberButton memberId={m.id} archived={archived} />}
        </aside>
      </div>

      {showHistory && data.history.length > 0 && (
        <section className="mt-6 rounded-xl border bg-card p-5" aria-labelledby="historique">
          <h2 id="historique" className="mb-3 text-sm font-medium">
            Historique de la fiche
          </h2>
          <ol className="space-y-2 text-sm">
            {data.history.map((h) => (
              <li key={h.id} className="flex flex-wrap gap-x-3">
                <span className="text-muted-foreground">{formatDateTime(h.createdAt)}</span>
                <span>{auditLabel(h.action)}</span>
                <span className="text-muted-foreground">par {h.actorName}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
