import { execSync } from "node:child_process";
import { config as loadEnv } from "dotenv";

/** Applique les migrations sur la base de test avant toute la suite. */
export default function setup() {
  loadEnv({ quiet: true });
  const ownerUrl = process.env.TEST_MIGRATE_DATABASE_URL;
  if (!ownerUrl) throw new Error("TEST_MIGRATE_DATABASE_URL manquant (.env)");
  if (!ownerUrl.includes("_test")) {
    throw new Error("Sécurité : les tests refusent de migrer une base dont le nom ne contient pas « _test ».");
  }

  execSync("pnpm prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, MIGRATE_DATABASE_URL: ownerUrl },
  });
}
