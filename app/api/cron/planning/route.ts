import { timingSafeEqual } from "node:crypto";
import { extendAllHorizons } from "@/modules/classes/classes.service";

/**
 * Prolonge le planning des cours réguliers (8 semaines glissantes), à
 * appeler une fois par jour par un planificateur avec l'en-tête
 * « Authorization: Bearer <CRON_SECRET> ».
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET non configuré." }, { status: 503 });
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return Response.json({ error: "Non autorisé." }, { status: 401 });
  }
  return Response.json(await extendAllHorizons());
}
