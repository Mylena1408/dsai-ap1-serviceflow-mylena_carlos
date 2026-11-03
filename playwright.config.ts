import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import { loadEnv } from "vite";
import { getIsolatedTestDatabaseUrl } from "./tests/integration/database-url";

const developmentEnvironment = loadEnv("development", process.cwd(), "");
const testEnvironment = loadEnv("test", process.cwd(), "");

process.env.DATABASE_URL ??= developmentEnvironment.DATABASE_URL;
process.env.TEST_DATABASE_URL ??= testEnvironment.TEST_DATABASE_URL;

const testDatabaseUrl = getIsolatedTestDatabaseUrl();

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:3100",
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100/",
    env: {
      NODE_ENV: "development",
      DATABASE_URL: testDatabaseUrl,
      AUTH_SECRET: randomBytes(32).toString("base64"),
      // Webhooks (SPEC 2026-11-02-api-externa-webhooks, 5.6): a key made for this run and local receivers.
      WEBHOOK_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      WEBHOOK_ALLOW_LOCAL: "true",
      // Documents go to an in-process memory store; no real bucket is used (SPEC 21.15.7).
      TEST_DOCUMENT_STORAGE: "memory",
    },
    timeout: 120_000,
    reuseExistingServer: false,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
