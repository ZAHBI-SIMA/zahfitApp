"use client";

import { Field, FormMessage, NativeSelect } from "@/components/forms/form-feedback";
import { useFormAction } from "@/components/forms/use-form-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TenantRole } from "@/lib/generated/prisma/enums";
import { ROLE_LABELS, STAFF_ROLES } from "@/lib/labels";
import { changeStaffRoleAction, inviteStaffAction, setStaffStatusAction } from "@/modules/staff/staff.actions";

const ROLE_HINTS: Partial<Record<TenantRole, string>> = {
  ADMIN: "Tous les droits, y compris l'équipe et la facturation",
  MANAGER: "Gestion commerciale et financière, remboursements",
  RECEPTIONIST: "Inscriptions, encaissements, contrôle d'accès",
  COACH: "Planning, cours et présences",
  ACCOUNTANT: "Recettes, dépenses et rapports",
};

export function InviteStaffForm() {
  const { state, pending, onSubmit } = useFormAction(inviteStaffAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field name="name" label="Nom complet" state={state}>
          <Input id="name" name="name" required />
        </Field>
        <Field name="email" label="E-mail" state={state}>
          <Input id="email" name="email" type="email" required />
        </Field>
        <Field name="role" label="Rôle" state={state}>
          <NativeSelect id="role" name="role" defaultValue="RECEPTIONIST">
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]} — {ROLE_HINTS[r]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Envoi…" : "Envoyer l'invitation"}
        </Button>
      </div>
    </form>
  );
}

export function StaffRowActions({
  membershipId,
  role,
  status,
  isSelf,
}: {
  membershipId: string;
  role: TenantRole;
  status: "ACTIVE" | "DISABLED";
  isSelf: boolean;
}) {
  const roleForm = useFormAction(changeStaffRoleAction);
  const statusForm = useFormAction(setStaffStatusAction);
  if (isSelf) return <span className="text-xs text-muted-foreground">Vous</span>;
  const message = roleForm.state.message ?? statusForm.state.message;
  const ok = roleForm.state.message ? roleForm.state.ok : statusForm.state.ok;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={roleForm.onSubmit} className="flex items-center gap-2">
          <input type="hidden" name="membershipId" value={membershipId} />
          <NativeSelect name="role" defaultValue={role} aria-label="Rôle" className="w-40">
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </NativeSelect>
          <Button type="submit" size="sm" variant="secondary" disabled={roleForm.pending}>
            Appliquer
          </Button>
        </form>
        <form onSubmit={statusForm.onSubmit}>
          <input type="hidden" name="membershipId" value={membershipId} />
          <input type="hidden" name="status" value={status === "ACTIVE" ? "DISABLED" : "ACTIVE"} />
          <Button type="submit" size="sm" variant={status === "ACTIVE" ? "ghost" : "outline"} disabled={statusForm.pending}>
            {status === "ACTIVE" ? "Désactiver" : "Réactiver"}
          </Button>
        </form>
      </div>
      {message && <p className={ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>{message}</p>}
    </div>
  );
}
