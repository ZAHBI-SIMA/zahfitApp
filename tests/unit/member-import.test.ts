import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv";
import { analyzeMemberCsv } from "@/modules/members/members.import";

describe("parseCsv", () => {
  it("lit un export Excel français (BOM, « ; », CRLF)", () => {
    expect(parseCsv("﻿nom;prenom\r\nKoné;Awa\r\n")).toEqual([
      ["nom", "prenom"],
      ["Koné", "Awa"],
    ]);
  });

  it("gère les guillemets, les virgules et les \"\" échappés", () => {
    expect(parseCsv('nom,ville\n"Diallo, Fatou","Abidjan ""Plateau"""\n')).toEqual([
      ["nom", "ville"],
      ["Diallo, Fatou", 'Abidjan "Plateau"'],
    ]);
  });

  it("ignore les lignes vides", () => {
    expect(parseCsv("a;b\n\n1;2\n;\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("analyzeMemberCsv", () => {
  const csv = [
    "Nom;Prénom(s);Téléphone;E-mail",
    "Koné;Awa;07 01 02 03 04;awa@exemple.ci",
    "Bamba;Serge;0501020304;",
    "Traoré;;0101020304;",
    "Diallo;Fatou;123;",
    "Koné;Awa bis;+225 0701020304;",
    "Yao;Kouassi;0708091011;pas-un-email",
    "Ouattara;Ibrahim;0712345678;",
  ].join("\n");

  const existing = new Set(["+2250712345678"]);
  const result = analyzeMemberCsv(csv, existing);

  it("reconnaît les en-têtes avec accents et parenthèses", () => {
    expect(result.missingColumns).toEqual([]);
  });

  it("classe chaque ligne et compte les statuts", () => {
    expect(result.rows.map((r) => r.status)).toEqual([
      "ok",
      "ok",
      "error", // prénom manquant
      "error", // téléphone invalide
      "duplicate", // même numéro que la ligne 2
      "error", // e-mail invalide
      "duplicate", // déjà inscrit
    ]);
    expect(result.counts).toEqual({ ok: 2, duplicate: 2, error: 3 });
  });

  it("numérote les lignes comme Excel (en-tête = ligne 1)", () => {
    expect(result.rows[0].line).toBe(2);
    expect(result.rows[2].message).toContain("prénom manquant");
  });

  it("normalise les téléphones valides", () => {
    expect(result.rows[1].phone).toBe("+2250501020304");
  });

  it("signale les colonnes obligatoires absentes", () => {
    expect(analyzeMemberCsv("nom,email\nKoné,a@b.ci", new Set()).missingColumns).toEqual(["prénom", "téléphone"]);
  });
});
