import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import type { SupportMessageKind, SupportTicketPriority, SupportTicketStatus, TenantRole } from "@/lib/generated/prisma/enums";
import { ROLE_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import {
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  supportAccessActive,
  supportAccessEnd,
} from "@/modules/support/support.rules";

const STATUS_VARIANT: Record<SupportTicketStatus, "default" | "secondary" | "outline" | "destructive"> = {
  OPEN: "default",
  IN_PROGRESS: "secondary",
  WAITING_CUSTOMER: "destructive",
  RESOLVED: "outline",
  CLOSED: "outline",
};

export function TicketStatusBadge({ status }: { status: SupportTicketStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{TICKET_STATUS_LABELS[status]}</Badge>;
}

export function TicketPriorityBadge({ priority }: { priority: SupportTicketPriority }) {
  if (priority === "NORMAL") return null;
  return (
    <Badge variant={priority === "URGENT" || priority === "HIGH" ? "destructive" : "outline"}>
      {TICKET_PRIORITY_LABELS[priority]}
    </Badge>
  );
}

type ThreadMessage = {
  id: string;
  kind: SupportMessageKind;
  fromPlatform: boolean;
  body: string;
  authorName: string;
  createdAt: Date;
};

/**
 * Fil d'un ticket. Côté salle, les notes internes n'arrivent jamais
 * jusqu'ici (filtrées par le RLS) ; côté ZahDigit, elles sont signalées.
 */
export function TicketThread({ messages, viewer }: { messages: ThreadMessage[]; viewer: "tenant" | "platform" }) {
  return (
    <ol className="flex flex-col gap-3" aria-label="Historique du ticket">
      {messages.map((m) => {
        if (m.kind === "STATUS_CHANGE") {
          return (
            <li key={m.id} className="text-center text-xs text-muted-foreground">
              {m.body} · {m.fromPlatform ? "support ZahDigit" : m.authorName} · {formatDateTime(m.createdAt)}
            </li>
          );
        }
        const internal = m.kind === "INTERNAL_NOTE";
        const mine = viewer === "platform" ? m.fromPlatform : !m.fromPlatform;
        return (
          <li
            key={m.id}
            className={cn(
              "max-w-[85%] rounded-xl border p-3 text-sm",
              mine ? "self-end bg-brand/5" : "self-start bg-card",
              internal && "border-dashed border-amber-500/60 bg-amber-500/10",
            )}
          >
            <p className="mb-1 text-xs text-muted-foreground">
              {m.fromPlatform ? `${m.authorName} · support ZahDigit` : m.authorName} · {formatDateTime(m.createdAt)}
              {internal && " · note interne (invisible pour la salle)"}
            </p>
            <p className="whitespace-pre-wrap">{m.body}</p>
          </li>
        );
      })}
    </ol>
  );
}

type AccessRow = {
  id: string;
  platformUserName: string;
  targetUserName: string;
  targetRole: TenantRole;
  reason: string;
  startedAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
};

/** Historique des accès du support : la salle voit qui, quand, pourquoi et combien de temps. */
export function SupportAccessList({ accesses, now = new Date() }: { accesses: AccessRow[]; now?: Date }) {
  if (accesses.length === 0) {
    return <p className="text-sm text-muted-foreground">Le support ZahDigit n&apos;a jamais consulté cet espace.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b text-left text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Début</th>
            <th className="px-3 py-2 font-medium">Agent ZahDigit</th>
            <th className="px-3 py-2 font-medium">Espace consulté</th>
            <th className="px-3 py-2 font-medium">Motif</th>
            <th className="px-3 py-2 font-medium">Fin</th>
          </tr>
        </thead>
        <tbody>
          {accesses.map((a) => {
            const active = supportAccessActive(a, now);
            return (
              <tr key={a.id} className="border-b last:border-0">
                <td className="whitespace-nowrap px-3 py-2">{formatDateTime(a.startedAt)}</td>
                <td className="px-3 py-2">{a.platformUserName}</td>
                <td className="px-3 py-2">
                  {a.targetUserName} <span className="text-muted-foreground">({ROLE_LABELS[a.targetRole]})</span>
                </td>
                <td className="px-3 py-2">{a.reason}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  {active ? (
                    <Badge variant="destructive">En cours (jusqu&apos;à {formatDateTime(a.expiresAt)})</Badge>
                  ) : (
                    <>
                      {formatDateTime(supportAccessEnd(a))}
                      {!a.endedAt && <span className="text-muted-foreground"> (expiré)</span>}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
