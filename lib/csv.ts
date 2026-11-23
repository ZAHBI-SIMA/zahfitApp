/**
 * Lecteur CSV minimal et sans dépendance.
 * - Excel en français exporte avec « ; » : le séparateur est détecté sur
 *   la ligne d'en-tête (« ; », « , » ou tabulation).
 * - Gère les champs entre guillemets (y compris retours à la ligne et "").
 * - Retire le BOM UTF-8 ajouté par Excel.
 */
export function detectDelimiter(headerLine: string): string {
  const counts = [";", ",", "\t"].map((d) => [d, headerLine.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

export function parseCsv(text: string): string[][] {
  const input = text.replace(/^﻿/, "");
  const firstLineEnd = input.search(/\r?\n/);
  const delimiter = detectDelimiter(firstLineEnd === -1 ? input : input.slice(0, firstLineEnd));

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (inQuotes) {
      if (c === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"' && field === "") inQuotes = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Ignore les lignes entièrement vides (fréquentes en fin de fichier Excel).
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** « Prénom(s) » → « prenoms » : comparaison d'en-têtes tolérante. */
export function normalizeHeader(header: string): string {
  return header
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Écriture : cellule CSV (séparateur « ; »), guillemets seulement si nécessaire.
 * Un TEXTE qui commence par = + - @ est préfixé d'une apostrophe : sinon
 * Excel l'exécuterait comme une formule (injection via un libellé saisi).
 */
export const csvCell = (value: unknown) => {
  const s = value === null || value === undefined ? "" : String(value);
  const safe = typeof value === "string" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
