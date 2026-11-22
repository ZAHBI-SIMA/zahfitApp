import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

loadEnv({ quiet: true });

// Les tests utilisent TOUJOURS la base zahfit_test, jamais la base de dev.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testOwnerUrl = process.env.TEST_MIGRATE_DATABASE_URL;

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      // `server-only` lève une erreur hors du bundler React Server : neutralisé en test.
      "server-only": path.resolve(__dirname, "tests/setup/server-only-stub.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/setup/global-setup.ts"],
    // Les tests d'intégration partagent une base : exécution séquentielle.
    fileParallelism: false,
    env: {
      DATABASE_URL: testDatabaseUrl ?? "",
      TEST_OWNER_DATABASE_URL: testOwnerUrl ?? "",
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-123",
    },
  },
});
