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
      database.requestApproval.deleteMany(),
      database.requestCommentFile.deleteMany(),
      database.requestSectorEvent.deleteMany(),
      database.requestSlaPause.deleteMany(),
      database.requestEscalation.deleteMany(),
      database.requestSatisfactionEvent.deleteMany(),
      database.requestSatisfaction.deleteMany(),
      database.cannedResponse.deleteMany(),
      database.knowledgeArticle.deleteMany(),
      database.requestFieldUpdateEvent.deleteMany(),
      database.requestStageEvent.deleteMany(),
      database.requestFieldValue.deleteMany(),
      database.requestAttachment.deleteMany(),
      database.emailDelivery.deleteMany(),
      database.requestNotification.deleteMany(),
      database.outboxEvent.deleteMany(),
      database.requestPriorityEvent.deleteMany(),
      database.requestComment.deleteMany(),
      database.requestAssignmentEvent.deleteMany(),
      database.requestStatusEvent.deleteMany(),
      database.request.deleteMany(),
      database.serviceDocumentRequirement.deleteMany(),
      // A service's approval condition points to one of its fields (SPEC 2026-11-06-aprofundamento-configurabilidade, 4.4).
      database.service.updateMany({ data: { approvalConditionFieldId: null, approvalConditionValue: null } }),
      database.serviceField.deleteMany(),
      database.serviceStage.deleteMany(),
      database.service.deleteMany(),
      database.auditEntry.deleteMany(),
      database.managerAbsence.deleteMany(),
      database.userPermissionEvent.deleteMany(),
      database.userPermission.deleteMany(),
      database.notificationPreference.deleteMany(),
      database.webhookDelivery.deleteMany(),
      database.webhookEndpoint.deleteMany(),
      database.apiRateWindow.deleteMany(),
      database.apiToken.deleteMany(),
      database.businessHoliday.deleteMany(),
      database.businessCalendar.deleteMany(),
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
