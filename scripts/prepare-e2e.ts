import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { getIsolatedTestDatabaseUrl } from "../tests/integration/database-url";
import { bootstrapFirstAdmin } from "../src/modules/auth/infrastructure/prisma-bootstrap-admin";

const databaseUrl = getIsolatedTestDatabaseUrl();
const prismaCli = resolve(process.cwd(), "node_modules", "prisma", "build", "index.js");
const migration = spawnSync(
  process.execPath,
  [
    prismaCli,
    "migrate",
    "deploy",
    "--schema",
    resolve(process.cwd(), "prisma", "schema.prisma"),
  ],
  {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
  },
);

if (migration.stdout) process.stdout.write(migration.stdout);
if (migration.stderr) process.stderr.write(migration.stderr);
if (migration.error || migration.status !== 0) {
  throw new Error("Could not apply migrations to the dedicated E2E test database.");
}

const database = new PrismaClient({
  datasourceUrl: databaseUrl,
  log: [],
});

async function prepareDatabase(): Promise<void> {
  try {
    await database.$queryRaw`SELECT 1`;
    await database.$transaction([
      database.requestAttachment.deleteMany(),
      database.requestAssignmentEvent.deleteMany(),
      database.requestStatusEvent.deleteMany(),
      database.request.deleteMany(),
      database.serviceDocumentRequirement.deleteMany(),
      database.service.deleteMany(),
      database.user.deleteMany(),
      database.category.deleteMany(),
      database.sector.deleteMany(),
    ]);
    await bootstrapFirstAdmin(
      {
        name: "E2E Administrator",
        email: "e2e-admin@example.test",
        password: "E2E-only-admin-password",
      },
      database,
    );
  } finally {
    await database.$disconnect();
  }
}

prepareDatabase().catch(() => {
  console.error("Could not prepare the dedicated E2E database.");
  process.exitCode = 1;
});
