/**
 * Sprint 7 — récurrence hebdomadaire, fuseau horaire, disponibilités (fonctions pures).
 */
import { describe, expect, it } from "vitest";
import { zonedToUtc } from "@/lib/timezone";
import {
  fitsInDay,
  isAvailable,
  occurrenceDates,
  parseRanges,
  readAvailability,
  weekStart,
  weekdayOf,
} from "@/modules/classes/schedule";

describe("Récurrence hebdomadaire", () => {
  it("jour de semaine et lundi de la semaine", () => {
    expect(weekdayOf("2027-03-08")).toBe(1); // lundi
    expect(weekdayOf("2027-03-14")).toBe(7); // dimanche
    expect(weekStart("2027-03-14")).toBe("2027-03-08");
    expect(weekStart("2027-03-08")).toBe("2027-03-08");
  });

  it("tous les mercredis d'une période, bornes incluses", () => {
    const series = { weekday: 3, startsOn: "2027-03-01", endsOn: null };
    expect(occurrenceDates(series, "2027-03-10", "2027-03-31")).toEqual([
      "2027-03-10",
      "2027-03-17",
      "2027-03-24",
      "2027-03-31",
    ]);
  });

  it("respecte le début et la fin du cours régulier", () => {
    const series = { weekday: 3, startsOn: "2027-03-15", endsOn: "2027-03-30" };
    expect(occurrenceDates(series, "2027-03-01", "2027-04-30")).toEqual(["2027-03-17", "2027-03-24"]);
    expect(occurrenceDates(series, "2027-04-01", "2027-04-30")).toEqual([]);
  });

  it("une séance ne peut pas finir après minuit", () => {
    expect(fitsInDay("23:00", 60)).toBe(true);
    expect(fitsInDay("23:30", 60)).toBe(false);
  });
});

describe("Fuseau de la salle", () => {
  it("Abidjan = UTC, Lagos = UTC+1", () => {
    expect(zonedToUtc("2027-03-10", "18:00", "Africa/Abidjan").toISOString()).toBe("2027-03-10T18:00:00.000Z");
    expect(zonedToUtc("2027-03-10", "18:00", "Africa/Lagos").toISOString()).toBe("2027-03-10T17:00:00.000Z");
  });

  it("gère un changement d'heure (Paris, passage à l'heure d'été)", () => {
    expect(zonedToUtc("2027-03-27", "10:00", "Europe/Paris").toISOString()).toBe("2027-03-27T09:00:00.000Z");
    expect(zonedToUtc("2027-03-29", "10:00", "Europe/Paris").toISOString()).toBe("2027-03-29T08:00:00.000Z");
  });
});

describe("Disponibilités des coachs", () => {
  it("lit les créneaux saisis et refuse les créneaux invalides", () => {
    expect(parseRanges("06:00-12:00, 16:00 - 20:00")).toEqual({ ranges: ["06:00-12:00", "16:00-20:00"] });
    expect(parseRanges("")).toEqual({ ranges: [] });
    expect(parseRanges("6h-12h").error).toMatch(/invalide/);
    expect(parseRanges("12:00-08:00").error).toMatch(/précéder/);
  });

  it("le créneau doit tenir entièrement dans une disponibilité", () => {
    const dispo = readAvailability({ mer: ["06:00-12:00", "17:00-21:00"] });
    expect(isAvailable(dispo, 3, "18:00", 60)).toBe(true);
    expect(isAvailable(dispo, 3, "20:30", 60)).toBe(false); // déborde
    expect(isAvailable(dispo, 4, "18:00", 60)).toBe(false); // jeudi non déclaré
    expect(isAvailable(null, 4, "18:00", 60)).toBe(true); // rien déclaré : pas de contrainte
  });
});
