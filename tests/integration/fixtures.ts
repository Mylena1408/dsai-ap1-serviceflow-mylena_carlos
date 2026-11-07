import { PrismaClient } from "@prisma/client";
import { getIsolatedTestDatabaseUrl } from "./database-url";

export const prisma = new PrismaClient({
  datasourceUrl: getIsolatedTestDatabaseUrl(),
});

export async function resetTestFixtures(): Promise<void> {
  await prisma.$transaction([
    prisma.requestApproval.deleteMany(),
    prisma.requestCommentFile.deleteMany(),
    prisma.requestSectorEvent.deleteMany(),
    prisma.requestSlaPause.deleteMany(),
    prisma.requestLinkEvent.deleteMany(),
    prisma.requestLink.deleteMany(),
    prisma.requestEscalation.deleteMany(),
    prisma.requestSatisfactionEvent.deleteMany(),
    prisma.requestSatisfaction.deleteMany(),
    prisma.cannedResponse.deleteMany(),
    prisma.knowledgeArticle.deleteMany(),
    prisma.requestFieldUpdateEvent.deleteMany(),
    prisma.requestStageEvent.deleteMany(),
    prisma.requestFieldValue.deleteMany(),
    prisma.requestAttachment.deleteMany(),
    prisma.emailDelivery.deleteMany(),
    prisma.requestNotification.deleteMany(),
    prisma.outboxEvent.deleteMany(),
    prisma.requestPriorityEvent.deleteMany(),
    prisma.requestComment.deleteMany(),
    prisma.requestAssignmentEvent.deleteMany(),
    prisma.requestStatusEvent.deleteMany(),
    prisma.request.deleteMany(),
    prisma.serviceDocumentRequirement.deleteMany(),
    // A service's approval condition points to one of its fields (SPEC 2026-11-06-aprofundamento-configurabilidade, 4.4).
    prisma.service.updateMany({ data: { approvalConditionFieldId: null, approvalConditionValue: null } }),
    // A stage's condition points to a field too (SPEC 2026-11-06-aprofundamento-configurabilidade, 5.4).
    prisma.serviceStage.updateMany({ data: { conditionFieldId: null, conditionValue: null } }),
    prisma.serviceField.deleteMany(),
    prisma.serviceStage.deleteMany(),
    prisma.service.deleteMany(),
    prisma.auditEntry.deleteMany(),
    prisma.managerAbsence.deleteMany(),
    prisma.sectorEscalationRule.deleteMany(),
    prisma.userAccessRoleEvent.deleteMany(),
    prisma.userAccessRole.deleteMany(),
    prisma.accessRole.deleteMany(),
    prisma.userPermissionEvent.deleteMany(),
    prisma.userPermission.deleteMany(),
    prisma.notificationPreference.deleteMany(),
    prisma.webhookDelivery.deleteMany(),
    prisma.webhookEndpoint.deleteMany(),
    prisma.apiRateWindow.deleteMany(),
    prisma.apiToken.deleteMany(),
    prisma.businessHoliday.deleteMany(),
    prisma.businessCalendar.deleteMany(),
    prisma.user.deleteMany(),
    prisma.category.deleteMany(),
    prisma.sector.deleteMany(),
  ]);
}
