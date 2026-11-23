/**
 * Sprint 6 — jetons QR et règles d'accès (fonctions pures, sans base).
 */
import { describe, expect, it } from "vitest";
import { evaluateAccess, type AccessRulesContext, type AccessSubscription } from "@/modules/access/rules";
import {
  buildQrToken,
  deriveMemberKey,
  parseCredential,
  qrWindowStatus,
  toBase64Url,
  verifyQrSignature,
  windowOf,
  type QrCredential,
} from "@/modules/access/token";

const MEMBER = "0195f2a0-1111-7000-8000-000000000001";
const key = (seed: number) => toBase64Url(new Uint8Array(32).fill(seed));
const NOW = Date.parse("2027-03-10T10:00:00Z"); // mercredi

async function token(dayKey: string, window = windowOf(NOW)) {
  return buildQrToken(await deriveMemberKey(dayKey, MEMBER), MEMBER, window);
}

describe("QR dynamique", () => {
  it("un QR signé avec la clé de la salle est reconnu", async () => {
    const credential = parseCredential(await token(key(1))) as QrCredential;
    expect(credential.kind).toBe("qr");
    expect(await verifyQrSignature(key(1), credential)).toBe(true);
  });

  it("un QR d'une autre salle (autre clé) échoue à la signature", async () => {
    const credential = parseCredential(await token(key(2))) as QrCredential;
    expect(await verifyQrSignature(key(1), credential)).toBe(false);
  });

  it("changer l'adhérent ou la fenêtre invalide le QR", async () => {
    const original = await token(key(1));
    const otherMember = original.replace(MEMBER, "0195f2a0-1111-7000-8000-000000000002");
    const otherWindow = original.replace(`.${windowOf(NOW)}.`, `.${windowOf(NOW) + 1}.`);
    for (const forged of [otherMember, otherWindow]) {
      expect(await verifyQrSignature(key(1), parseCredential(forged) as QrCredential)).toBe(false);
    }
  });

  it("validité de 30 à 60 s, tolérance d'une fenêtre d'avance", () => {
    const w = windowOf(NOW);
    expect(qrWindowStatus(w, NOW)).toBe("valid");
    expect(qrWindowStatus(w - 1, NOW)).toBe("valid");
    expect(qrWindowStatus(w - 2, NOW)).toBe("expired");
    expect(qrWindowStatus(w + 1, NOW)).toBe("valid");
    expect(qrWindowStatus(w + 2, NOW)).toBe("future");
  });

  it("reconnaît un badge (casse et espaces tolérés) et rejette le reste", () => {
    expect(parseCredential(" zb-abcd23efgh ")).toEqual({ kind: "badge", code: "ZB-ABCD23EFGH" });
    expect(parseCredential("ZBABCD23EFGH")).toEqual({ kind: "badge", code: "ZB-ABCD23EFGH" });
    expect(parseCredential("ZB-ABCD0OEFGH")).toBeNull(); // 0 et O exclus de l'alphabet
    expect(parseCredential("https://exemple.ci")).toBeNull();
    expect(parseCredential("ZF1.pas-un-uuid.1.xxxxxxxxxxxxxxxxxxxxxx")).toBeNull();
  });
});

const sub = (extra: Partial<AccessSubscription> = {}): AccessSubscription => ({
  id: "s1",
  status: "ACTIVE",
  startDate: "2027-03-01",
  endDate: "2027-03-31",
  planName: "Mensuel",
  allowedDays: [],
  accessFrom: null,
  accessUntil: null,
  maxEntries: null,
  entriesUsed: 0,
  ...extra,
});

const ctx = (extra: Partial<AccessRulesContext> = {}): AccessRulesContext => ({
  now: new Date(NOW),
  timezone: "Africa/Abidjan",
  openingHours: null,
  antiPassbackMinutes: 60,
  lastGrantedAt: null,
  ...extra,
});

const reason = (subs: AccessSubscription[], extra: Partial<AccessRulesContext> = {}) =>
  evaluateAccess({ status: "ACTIVE" }, subs, ctx(extra)).reason;

describe("Règles d'accès", () => {
  it("abonnement en cours : autorisé", () => {
    expect(reason([sub()])).toBe("GRANTED");
  });

  it("explique précisément l'absence d'abonnement en cours", () => {
    expect(reason([])).toBe("NO_SUBSCRIPTION");
    expect(reason([sub({ status: "FROZEN" })])).toBe("SUBSCRIPTION_FROZEN");
    expect(reason([sub({ startDate: "2027-03-15" })])).toBe("NOT_STARTED");
    expect(reason([sub({ status: "PENDING_PAYMENT" })])).toBe("PAYMENT_PENDING");
    expect(reason([sub({ endDate: "2027-03-09" })])).toBe("SUBSCRIPTION_EXPIRED");
    expect(reason([sub({ status: "CANCELLED" })])).toBe("SUBSCRIPTION_CANCELLED");
  });

  it("le dernier jour de l'abonnement est inclus", () => {
    expect(reason([sub({ endDate: "2027-03-10" })])).toBe("GRANTED");
  });

  it("adhérent archivé ou suspendu : refusé même avec un abonnement", () => {
    expect(evaluateAccess({ status: "ARCHIVED" }, [sub()], ctx()).reason).toBe("MEMBER_ARCHIVED");
    expect(evaluateAccess({ status: "SUSPENDED" }, [sub()], ctx()).reason).toBe("MEMBER_SUSPENDED");
  });

  it("jours et créneau de la formule", () => {
    expect(reason([sub({ allowedDays: [6, 7] })])).toBe("DAY_NOT_ALLOWED"); // week-end seulement, on est mercredi
    expect(reason([sub({ allowedDays: [3] })])).toBe("GRANTED");
    expect(reason([sub({ accessFrom: "06:00", accessUntil: "09:00" })])).toBe("OUTSIDE_HOURS");
    expect(reason([sub({ accessFrom: "06:00", accessUntil: "10:00" })])).toBe("OUTSIDE_HOURS"); // fin exclue
    expect(reason([sub({ accessFrom: "10:00", accessUntil: "12:00" })])).toBe("GRANTED");
  });

  it("horaires d'ouverture de la salle", () => {
    const hours = {
      lun: "06:00-22:00",
      mar: "06:00-22:00",
      mer: null,
      jeu: "06:00-22:00",
      ven: "06:00-22:00",
      sam: null,
      dim: null,
    };
    expect(reason([sub()], { openingHours: hours })).toBe("GYM_CLOSED");
    expect(reason([sub()], { openingHours: { ...hours, mer: "12:00-22:00" } })).toBe("OUTSIDE_HOURS");
    expect(reason([sub()], { openingHours: { ...hours, mer: "06:00-22:00" } })).toBe("GRANTED");
  });

  it("le fuseau de la salle décide du jour et de l'heure", () => {
    // 10:00 UTC = 11:00 à Lagos (UTC+1) : hors d'un créneau 10:00-11:00 côté Lagos.
    expect(reason([sub({ accessFrom: "10:00", accessUntil: "11:00" })], { timezone: "Africa/Lagos" })).toBe(
      "OUTSIDE_HOURS",
    );
  });

  it("quota d'entrées", () => {
    expect(reason([sub({ maxEntries: 10, entriesUsed: 9 })])).toBe("GRANTED");
    expect(reason([sub({ maxEntries: 10, entriesUsed: 10 })])).toBe("QUOTA_REACHED");
  });

  it("anti-passback : pas deux entrées en moins de X minutes", () => {
    const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000);
    expect(reason([sub()], { lastGrantedAt: at(59) })).toBe("PASSBACK");
    expect(reason([sub()], { lastGrantedAt: at(60) })).toBe("GRANTED");
    expect(reason([sub()], { lastGrantedAt: at(1), antiPassbackMinutes: 0 })).toBe("GRANTED");
  });
});
