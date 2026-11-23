import type { Metadata } from "next";
import Link from "next/link";
import { MarkAllReadButton } from "@/components/bookings/booking-forms";
import { PageHeader } from "@/components/shell/page-header";
import { withTenant } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { requireSpace } from "@/lib/session";
import { cn } from "@/lib/utils";
import { listNotifications } from "@/modules/notifications/notifications.service";

export const metadata: Metadata = { title: "Notifications" };

export default async function MemberNotificationsPage() {
  const ctx = await requireSpace("member");
  const items = await withTenant(ctx.tenant.id, ctx.user.id, (tx) => listNotifications(tx, ctx.user.id));
  const unread = items.filter((n) => !n.readAt).length;

  return (
    <>
      <PageHeader title="Notifications" description={unread ? `${unread} non lue(s)` : "Tout est lu"}>
        {unread > 0 && <MarkAllReadButton />}
      </PageHeader>
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">Aucune notification.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((n) => (
            <li
              key={n.id}
              className={cn("rounded-xl border bg-card p-4 text-sm", !n.readAt && "border-brand/50 bg-brand/5")}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">
                  {!n.readAt && <span className="mr-2 inline-block size-2 rounded-full bg-brand" aria-label="Non lue" />}
                  {n.title}
                </p>
                <span className="text-xs text-muted-foreground">{formatDateTime(n.createdAt)}</span>
              </div>
              <p className="mt-1 text-muted-foreground">{n.body}</p>
              {n.link && (
                <Link href={n.link} className="mt-1 inline-block text-xs text-brand hover:underline">
                  Voir
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
