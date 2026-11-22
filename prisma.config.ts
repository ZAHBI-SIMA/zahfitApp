import "dotenv/config";
import { defineConfig } from "prisma/config";

// Les migrations s'exécutent avec le rôle PROPRIÉTAIRE (zahfit_owner).
// L'application, elle, se connecte avec zahfit_app (voir lib/db.ts).
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.MIGRATE_DATABASE_URL ?? "",
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
