/**
 * Fuseau horaire de la salle — fonctions PURES et isomorphes.
 * La Côte d'Ivoire (Africa/Abidjan) est en UTC+0 sans heure d'été, mais
 * `Tenant.timezone` existe : le code ne suppose jamais que c'est UTC.
 */

/** Date « AAAA-MM-JJ », jour de semaine (1 = lundi) et heure « HH:MM » dans le fuseau. */
export function localParts(now: Date, timezone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday) + 1;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday, time: `${parts.hour}:${parts.minute}` };
}

/** Décalage (ms) du fuseau par rapport à UTC à un instant donné. */
function offsetMs(instant: Date, timezone: string): number {
  const p = localParts(instant, timezone);
  const asUtc = Date.parse(`${p.date}T${p.time}:00Z`);
  return asUtc - Math.floor(instant.getTime() / 60_000) * 60_000;
}

/**
 * « 2027-03-10 » + « 18:30 » dans le fuseau de la salle → instant UTC.
 * Deux passes pour tomber juste même autour d'un changement d'heure.
 */
export function zonedToUtc(date: string, time: string, timezone: string): Date {
  const naive = Date.parse(`${date}T${time}:00Z`);
  let guess = naive - offsetMs(new Date(naive), timezone);
  guess = naive - offsetMs(new Date(guess), timezone);
  return new Date(guess);
}
