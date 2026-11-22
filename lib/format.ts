/** Formats d'affichage : français, fuseau Africa/Abidjan (UTC+0, sans heure d'été). */
const TZ = "Africa/Abidjan";

const dateFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, dateStyle: "medium" });
const dateTimeFmt = new Intl.DateTimeFormat("fr-FR", {
  timeZone: TZ,
  dateStyle: "short",
  timeStyle: "short",
});

export const formatDate = (d: Date | null | undefined) => (d ? dateFmt.format(d) : "—");
export const formatDateTime = (d: Date | null | undefined) => (d ? dateTimeFmt.format(d) : "—");

/** Date « calendaire » (colonne @db.Date) → valeur d'un <input type="date">. */
export const toDateInput = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

/** Montant en FCFA : stocké en entier (le XOF n'a pas de centimes utilisés). */
export const formatXof = (amount: number) =>
  `${new Intl.NumberFormat("fr-FR").format(amount)} FCFA`;
