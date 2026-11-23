/**
 * Critère d'acceptation du cahier des charges (section 14) :
 * « Abonnement — calcul exact des dates ».
 */
import { describe, expect, it } from "vitest";
import type { DurationUnit } from "@/lib/generated/prisma/enums";
import {
  computeEndDate,
  computeUnfreeze,
  effectiveStatus,
  isoDate,
  overlaps,
  parseCalendarDate,
  remainingDays,
  renewalStartDate,
} from "@/modules/subscriptions/dates";

const d = (iso: string) => parseCalendarDate(iso)!;

describe("computeEndDate (fin incluse)", () => {
  it.each<[string, number, DurationUnit, string, string]>([
    ["2027-01-01", 1, "DAY", "2027-01-01", "journalier : même jour"],
    ["2027-01-01", 7, "DAY", "2027-01-07", "7 jours"],
    ["2027-01-01", 1, "WEEK", "2027-01-07", "hebdomadaire"],
    ["2027-12-25", 2, "WEEK", "2028-01-07", "2 semaines à cheval sur l'année"],
    ["2027-01-01", 1, "MONTH", "2027-01-31", "mois calendaire plein"],
    ["2027-01-15", 1, "MONTH", "2027-02-14", "quantième − 1"],
    ["2027-01-28", 1, "MONTH", "2027-02-27", "28 janv. → 27 févr."],
    ["2027-01-29", 1, "MONTH", "2027-02-28", "29 janv. sans 29 févr. → dernier jour"],
    ["2027-01-31", 1, "MONTH", "2027-02-28", "31 janv. → 28 févr."],
    ["2028-01-31", 1, "MONTH", "2028-02-29", "année bissextile"],
    ["2028-01-30", 1, "MONTH", "2028-02-29", "30 janv. bissextile"],
    ["2027-03-31", 1, "MONTH", "2027-04-30", "31 mars → 30 avril"],
    ["2027-12-15", 1, "MONTH", "2028-01-14", "changement d'année"],
    ["2027-11-30", 3, "MONTH", "2028-02-29", "trimestriel vers février bissextile"],
    ["2027-08-31", 6, "MONTH", "2028-02-29", "semestriel 31 août"],
    ["2027-03-01", 1, "YEAR", "2028-02-29", "annuel : veille du 1er mars bissextile"],
    ["2028-02-29", 1, "YEAR", "2029-02-28", "annuel depuis un 29 février"],
    ["2027-01-01", 1, "YEAR", "2027-12-31", "année civile"],
    ["2027-05-10", 12, "MONTH", "2028-05-09", "12 mois = 1 an"],
  ])("%s + %i %s → %s (%s)", (start, value, unit, expected) => {
    expect(isoDate(computeEndDate(d(start), value, unit))).toBe(expected);
  });

  it("12 mois et 1 an donnent toujours la même fin", () => {
    for (const start of ["2027-01-31", "2028-02-29", "2027-06-15", "2027-12-31"]) {
      expect(computeEndDate(d(start), 12, "MONTH")).toEqual(computeEndDate(d(start), 1, "YEAR"));
    }
  });
});

describe("renewalStartDate", () => {
  const today = d("2027-03-10");
  it("renouvellement anticipé : démarre le lendemain de la fin (aucun jour perdu)", () => {
    expect(isoDate(renewalStartDate(d("2027-03-20"), today))).toBe("2027-03-21");
  });
  it("abonnement qui finit aujourd'hui : démarre demain", () => {
    expect(isoDate(renewalStartDate(d("2027-03-10"), today))).toBe("2027-03-11");
  });
  it("renouvellement tardif : démarre aujourd'hui (pas de rattrapage rétroactif)", () => {
    expect(isoDate(renewalStartDate(d("2027-02-01"), today))).toBe("2027-03-10");
  });
  it("premier abonnement : aujourd'hui", () => {
    expect(isoDate(renewalStartDate(null, today))).toBe("2027-03-10");
  });
});

describe("effectiveStatus et remainingDays", () => {
  const today = d("2027-03-10");
  const sub = (start: string, end: string, status = "ACTIVE" as const) => ({
    status,
    startDate: d(start),
    endDate: d(end),
  });

  it("en cours", () => expect(effectiveStatus(sub("2027-03-01", "2027-03-31"), today)).toBe("ACTIVE"));
  it("expiré si la fin est passée, même si la base dit ACTIVE", () =>
    expect(effectiveStatus(sub("2027-02-01", "2027-03-09"), today)).toBe("EXPIRED"));
  it("à venir si le début est dans le futur", () =>
    expect(effectiveStatus(sub("2027-03-11", "2027-04-10"), today)).toBe("UPCOMING"));
  it("le dernier jour est encore valable", () => {
    expect(effectiveStatus(sub("2027-02-11", "2027-03-10"), today)).toBe("ACTIVE");
    expect(remainingDays(sub("2027-02-11", "2027-03-10"), today)).toBe(1);
  });
  it("les statuts non actifs sont conservés", () => {
    expect(effectiveStatus({ status: "FROZEN", startDate: d("2027-01-01"), endDate: d("2027-01-31") }, today)).toBe("FROZEN");
    expect(effectiveStatus({ status: "PENDING_PAYMENT", startDate: d("2027-03-10"), endDate: d("2027-04-09") }, today)).toBe(
      "PENDING_PAYMENT",
    );
  });
  it("un abonnement à venir compte toute sa durée", () =>
    expect(remainingDays(sub("2027-03-11", "2027-03-20"), today)).toBe(10));
  it("un abonnement expiré n'a plus de jours", () => expect(remainingDays(sub("2027-01-01", "2027-01-31"), today)).toBe(0));
});

describe("computeUnfreeze (suspension)", () => {
  const base = { endDate: d("2027-03-31"), frozenSince: d("2027-03-01"), frozenDays: 0, maxFreezeDays: 30 };

  it("rend les jours gelés", () => {
    const r = computeUnfreeze(base, d("2027-03-11"));
    expect(r.credited).toBe(10);
    expect(isoDate(r.newEndDate)).toBe("2027-04-10");
    expect(r.frozenDays).toBe(10);
  });
  it("plafonne au maximum autorisé par la formule", () => {
    const r = computeUnfreeze(base, d("2027-04-10"));
    expect(r.credited).toBe(30);
    expect(r.overflow).toBe(10);
  });
  it("tient compte des gels précédents", () => {
    const r = computeUnfreeze({ ...base, frozenDays: 25 }, d("2027-03-11"));
    expect(r.credited).toBe(5);
    expect(r.frozenDays).toBe(30);
  });
  it("reprise le jour même : rien à rendre", () => expect(computeUnfreeze(base, d("2027-03-01")).credited).toBe(0));
});

describe("utilitaires", () => {
  it("rejette les dates impossibles", () => {
    expect(parseCalendarDate("2027-02-30")).toBeNull();
    expect(parseCalendarDate("27-1-1")).toBeNull();
    expect(parseCalendarDate("2028-02-29")).not.toBeNull();
  });
  it("détecte les chevauchements (bornes incluses)", () => {
    const a = { startDate: d("2027-01-01"), endDate: d("2027-01-31") };
    expect(overlaps(a, { startDate: d("2027-01-31"), endDate: d("2027-02-28") })).toBe(true);
    expect(overlaps(a, { startDate: d("2027-02-01"), endDate: d("2027-02-28") })).toBe(false);
  });
});
