import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const testEnvironment = loadEnv("test", process.cwd(), "");

// TEST_DOCUMENT_STORAGE_* enable the real-bucket storage test (SPEC 21.15.7); without
// them that test is skipped.
for (const key of [
  "DATABASE_URL",
  "TEST_DATABASE_URL",
  "TEST_DOCUMENT_STORAGE_URL",
  "TEST_DOCUMENT_STORAGE_BUCKET",
  "TEST_DOCUMENT_STORAGE_SECRET_KEY",
] as const) {
  if (process.env[key] === undefined && testEnvironment[key] !== undefined) {
    process.env[key] = testEnvironment[key];
  }
}

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    globalSetup: ["./tests/integration/global-setup.ts"],
    setupFiles: ["./tests/integration/setup.ts"],
    fileParallelism: false,
    maxWorkers: 1,
  },
});
