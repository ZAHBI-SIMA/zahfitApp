import { describe, expect, it } from "vitest";
import { formatPhone, normalizePhone } from "@/lib/phone";

describe("normalizePhone (Côte d'Ivoire, 10 chiffres depuis 2021)", () => {
  it.each([
    ["07 01 02 03 04", "+2250701020304"],
    ["0701020304", "+2250701020304"],
    ["07.01.02.03.04", "+2250701020304"],
    ["+225 07 01 02 03 04", "+2250701020304"],
    ["00225 0701020304", "+2250701020304"],
    ["+33 6 12 34 56 78", "+33612345678"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([
    ["", "vide"],
    ["01020304", "ancien format à 8 chiffres"],
    ["7701020304", "10 chiffres sans 0 initial"],
    ["+225 0701", "indicatif ivoirien trop court"],
    ["abc", "texte"],
  ])("rejette %s (%s)", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it("formate pour l'affichage", () => {
    expect(formatPhone("+2250701020304")).toBe("07 01 02 03 04");
    expect(formatPhone("+33612345678")).toBe("+33612345678");
  });
});
