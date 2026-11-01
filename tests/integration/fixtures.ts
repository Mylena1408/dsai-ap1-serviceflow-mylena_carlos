import { PrismaClient } from "@prisma/client";
import { getIsolatedTestDatabaseUrl } from "./database-url";

export const prisma = new PrismaClient({
  datasourceUrl: getIsolatedTestDatabaseUrl(),
});

export async function resetTestFixtures(): Promise<void> {
  await prisma.$transaction([
    prisma.requestStageEvent.deleteMany(),
    prisma.requestFieldValue.deleteMany(),
    prisma.requestAttachment.deleteMany(),
    prisma.requestNotification.deleteMany(),
    prisma.outboxEvent.deleteMany(),
    prisma.requestPriorityEvent.deleteMany(),
    prisma.requestComment.deleteMany(),
    prisma.requestAssignmentEvent.deleteMany(),
    prisma.requestStatusEvent.deleteMany(),
    prisma.request.deleteMany(),
    prisma.serviceDocumentRequirement.deleteMany(),
    prisma.serviceField.deleteMany(),
    prisma.serviceStage.deleteMany(),
    prisma.service.deleteMany(),
    prisma.user.deleteMany(),
    prisma.category.deleteMany(),
    prisma.sector.deleteMany(),
  ]);
}
