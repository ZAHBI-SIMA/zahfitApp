"use client";

import Link from "next/link";
import { FormMessage } from "@/components/forms/form-feedback";
import { useFormAction } from "@/components/forms/use-form-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPhone } from "@/lib/phone";
import { importMembersAction, type ImportState } from "@/modules/members/members.actions";

const STATUS = {
  ok: { label: "À importer", variant: "secondary" },
  duplicate: { label: "Doublon", variant: "outline" },
  error: { label: "Erreur", variant: "destructive" },
} as const;

export function ImportMembersForm() {
  const { state, pending, onSubmit } = useFormAction<ImportState>(importMembersAction, {});
  const analysis = state.analysis;

  if (state.imported !== undefined) {
    return (
      <div className="flex flex-col items-start gap-4">
        <FormMessage state={state} />
        <Button nativeButton={false} render={<Link href="/admin/adherents" />}>
          Voir la liste des adhérents
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <FormMessage state={state} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="file" className="text-sm font-medium">
            Fichier CSV (1 Mo, 2 000 lignes maximum)
          </label>
          <Input id="file" name="file" type="file" accept=".csv,text/csv" required className="max-w-sm" />
        </div>
        <Button type="submit" name="intent" value="preview" variant="outline" disabled={pending}>
          {pending ? "Analyse…" : "Analyser le fichier"}
        </Button>
      </div>

      {analysis && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant="secondary">{analysis.counts.ok} à importer</Badge>
            <Badge variant="outline">{analysis.counts.duplicate} doublon(s) ignoré(s)</Badge>
            <Badge variant="destructive">{analysis.counts.error} ligne(s) en erreur</Badge>
            {analysis.truncated && <Badge variant="destructive">Fichier tronqué à 2 000 lignes</Badge>}
          </div>

          <div className="max-h-[420px] overflow-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead className="sticky top-0 border-b bg-card text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Ligne</th>
                  <th className="px-3 py-2 font-medium">Nom</th>
                  <th className="px-3 py-2 font-medium">Téléphone</th>
                  <th className="px-3 py-2 font-medium">Statut</th>
                </tr>
              </thead>
              <tbody>
                {analysis.rows.map((row) => (
                  <tr key={row.line} className="border-b last:border-0">
                    <td className="px-3 py-2 text-muted-foreground">{row.line}</td>
                    <td className="px-3 py-2">
                      {row.lastName} {row.firstName}
                    </td>
                    <td className="px-3 py-2">{row.phone.startsWith("+") ? formatPhone(row.phone) : row.phone}</td>
                    <td className="px-3 py-2">
                      <Badge variant={STATUS[row.status].variant}>{STATUS[row.status].label}</Badge>
                      {row.message && <span className="ml-2 text-xs text-muted-foreground">{row.message}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {analysis.counts.ok > 0 && (
            <div>
              <Button type="submit" name="intent" value="commit" size="lg" disabled={pending}>
                {pending ? "Import en cours…" : `Importer ${analysis.counts.ok} adhérent(s)`}
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                Le fichier est revérifié au moment de l&apos;import. Les consentements de communication
                restent à « non » : à recueillir auprès de chaque adhérent.
              </p>
            </div>
          )}
        </div>
      )}
    </form>
  );
}
