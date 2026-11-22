"use client";

import { FormMessage } from "@/components/forms/form-feedback";
import { useFormAction } from "@/components/forms/use-form-action";
import { Button } from "@/components/ui/button";
import { setMemberArchivedAction } from "@/modules/members/members.actions";

export function ArchiveMemberButton({ memberId, archived }: { memberId: string; archived: boolean }) {
  const { state, pending, onSubmit } = useFormAction(setMemberArchivedAction);

  return (
    <form
      onSubmit={(event) => {
        if (!archived && !confirm("Archiver cet adhérent ? Il n'apparaîtra plus dans la liste (restauration possible).")) {
          event.preventDefault();
          return;
        }
        onSubmit(event);
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="id" value={memberId} />
      <input type="hidden" name="archived" value={archived ? "false" : "true"} />
      <Button type="submit" variant={archived ? "secondary" : "destructive"} disabled={pending}>
        {archived ? "Restaurer l'adhérent" : "Archiver l'adhérent"}
      </Button>
      {!state.ok && <FormMessage state={state} />}
    </form>
  );
}
