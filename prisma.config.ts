import "dotenv/config";
import { defineConfig } from "prisma/config";

// Les migrations s'exécutent avec le rôle PROPRIÉTAIRE (zahfit_owner).
// L'application, elle, se connecte avec zahfit_app (voir lib/db.ts).
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // Condition « react-server » : le seed s'exécute comme le serveur Next
    // (les modules marqués `server-only` sont alors importables).
    seed: "tsx --conditions=react-server prisma/seed.ts",
  },
  datasource: {
    url: process.env.MIGRATE_DATABASE_URL ?? "",
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
