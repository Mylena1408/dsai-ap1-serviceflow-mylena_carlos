import type { Prisma, PrismaClient } from "@prisma/client";
import { planAuditEntry } from "@/modules/audit";
import { decimalLimitText } from "@/modules/service-fields";
import type { ConfigurationExportStore } from "../application/export-configuration";
import type { ConfigurationSnapshot } from "../domain/export";

// Reading the configuration for the export (SPEC 2026-11-07-operacao-e-automacao, 6.3 item 2): every
// configuration table, active and inactive items, in one repeatable-read transaction so the file is one
// consistent picture. People are read only for the e-mails the configuration refers to.

/** The configuration has no row of its own: its audit entries share this entity id. */
export const CONFIGURATION_ENTITY_ID = "00000000-0000-0000-0000-000000000000";
export const CONFIGURATION_ENTITY_LABEL = "Configuração da organização";

const order = [{ createdAt: "asc" as const }, { id: "asc" as const }];

/** The configuration read with `client`; inside a transaction, the import's application reads it this way. */
export async function readSnapshot(client: Prisma.TransactionClient): Promise<ConfigurationSnapshot> {
  const [sectors, escalationRules, cannedResponses, categories, services, fields, documents, stages, articles, accessRoles, calendar, holidays, bundles] =
    await Promise.all([
      client.sector.findMany({
        orderBy: order,
        select: { id: true, name: true, isActive: true, escalateOverdue: true, distributionMode: true, maxActivePerAttendant: true, redistributeOnAbsence: true },
      }),
      client.sectorEscalationRule.findMany({
        orderBy: order,
        select: {
          sectorId: true,
          name: true,
          trigger: true,
          overdueDays: true,
          raisePriority: true,
          assignToId: true,
          notifyManagers: true,
          notifyTeam: true,
          notifyUserIds: true,
          isActive: true,
        },
      }),
      client.cannedResponse.findMany({ orderBy: order, select: { sectorId: true, title: true, body: true, isActive: true } }),
      client.category.findMany({ orderBy: order, select: { id: true, name: true, isActive: true } }),
      client.service.findMany({
        orderBy: order,
        select: {
          id: true,
          name: true,
          description: true,
          categoryId: true,
          sectorId: true,
          isActive: true,
          defaultPriority: true,
          slaHours: true,
          slaBusinessHours: true,
          requiresApproval: true,
          approvalSectorIds: true,
          approvalConditionFieldId: true,
          approvalConditionValue: true,
          approvalDeadlineDays: true,
        },
      }),
      client.serviceField.findMany({
        orderBy: order,
        select: {
          id: true,
          serviceId: true,
          label: true,
          helpText: true,
          type: true,
          audience: true,
          isRequired: true,
          options: true,
          minValue: true,
          maxValue: true,
          decimalPlaces: true,
          minDecimal: true,
          maxDecimal: true,
          position: true,
          isActive: true,
          conditionFieldId: true,
          conditionValue: true,
        },
      }),
      client.serviceDocumentRequirement.findMany({
        orderBy: order,
        select: { serviceId: true, name: true, isRequired: true, acceptedFormats: true, position: true, isActive: true },
      }),
      client.serviceStage.findMany({
        orderBy: order,
        select: { serviceId: true, name: true, position: true, isActive: true, assigneeId: true, targetDays: true, conditionFieldId: true, conditionValue: true },
      }),
      client.knowledgeArticle.findMany({ orderBy: order, select: { serviceId: true, title: true, body: true, isPublished: true, position: true } }),
      client.accessRole.findMany({ orderBy: order, select: { name: true, description: true, permissions: true, isActive: true } }),
      client.businessCalendar.findUnique({ where: { id: 1 }, select: { weekdays: true, startMinute: true, endMinute: true, timeZone: true } }),
      client.businessHoliday.findMany({ orderBy: { day: "asc" }, select: { day: true, name: true, yearly: true } }),
      client.serviceBundle.findMany({ orderBy: order, select: { name: true, description: true, serviceIds: true, isActive: true } }),
    ]);

  const userIds = new Set<string>();
  for (const rule of escalationRules) {
    if (rule.assignToId) userIds.add(rule.assignToId);
    for (const id of rule.notifyUserIds) userIds.add(id);
  }
  for (const stage of stages) if (stage.assigneeId) userIds.add(stage.assigneeId);
  const people = await client.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, email: true } });

  return {
    sectors,
    escalationRules,
    cannedResponses,
    categories,
    services,
    fields: fields.map((field) => ({
      ...field,
      minDecimal: decimalLimitText(field.minDecimal, field.decimalPlaces),
      maxDecimal: decimalLimitText(field.maxDecimal, field.decimalPlaces),
    })),
    documents,
    stages,
    articles,
    accessRoles,
    calendar,
    holidays: holidays.map((holiday) => ({ ...holiday, day: holiday.day.toISOString().slice(0, 10) })),
    bundles,
    emails: Object.fromEntries(people.map((person) => [person.id, person.email])),
  };
}

/** The whole configuration as one consistent picture (also read by the import's preview). */
export function readConfigurationSnapshot(database: PrismaClient): Promise<ConfigurationSnapshot> {
  return database.$transaction((client) => readSnapshot(client), { isolationLevel: "RepeatableRead" });
}

export function createPrismaConfigurationExportStore(database: PrismaClient): ConfigurationExportStore {
  return {
    snapshot: () => readConfigurationSnapshot(database),
    async now() {
      const [{ now }] = await database.$queryRaw<Array<{ now: Date }>>`SELECT now() AS "now"`;
      return now;
    },
    async recordExport(actor) {
      const entry = planAuditEntry(
        { actor, action: "EXPORTED_CONFIGURATION", entityType: "CONFIGURATION", entityId: CONFIGURATION_ENTITY_ID, entityLabel: CONFIGURATION_ENTITY_LABEL },
        null,
        {},
      );
      if (entry) {
        await database.auditEntry.create({ data: { ...entry, changes: entry.changes as unknown as Prisma.InputJsonValue } });
      }
    },
  };
}
