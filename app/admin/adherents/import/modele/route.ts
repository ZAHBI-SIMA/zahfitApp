/**
 * Modèle CSV d'import des adhérents. « ; » et BOM UTF-8 : s'ouvre
 * directement dans Excel en français avec les accents corrects.
 */
const TEMPLATE = "﻿nom;prenom;telephone;email\r\nKoné;Awa;07 01 02 03 04;awa.kone@exemple.ci\r\n";

export function GET() {
  return new Response(TEMPLATE, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="modele-import-adherents.csv"',
    },
  });
}
