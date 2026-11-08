import type { AuditEntityType, Prisma, PrismaClient } from "@prisma/client";
import { createPrismaAuditScope, planAuditEntry, type AuditActor } from "@/modules/audit";
import { parseCalendarInput } from "@/modules/calendar";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import { BUSINESS_CALENDAR_AUDIT_ID } from "@/shared/business-clock";
import type { ConfigurationApplyStore, ConfigurationApplyTransaction, ImportPlan } from "../application/apply-import";
import { keyOf, type ConfigurationData } from "../domain/format";
import { pathOf, type ItemKind, type ItemStatus } from "../domain/preview";
import { CONFIGURATION_ENTITY_ID, CONFIGURATION_ENTITY_LABEL, readSnapshot } from "./prisma-configuration-export";
import { readFacts, readPeople } from "./prisma-configuration-import";

// Applying an import in PostgreSQL (SPEC 2026-11-07-operacao-e-automacao, 6.3 item 5): one serializable
// transaction; items equal to the destination are not touched; new items are created and changed ones
// updated, each with its audit entry as its screen writes it (canned responses have no audit entry on their
// screen either). The order follows the references: sectors and categories, services, their fields (and then
// the conditions, which point to fields), documents, stages, articles, the sectors' rules and responses,
// roles, the calendar, holidays and bundles. Nothing is deleted.

type Tx = Prisma.TransactionClient;

const dateOf = (day: string) => new Date(`${day}T00:00:00.000Z`);
const APPLY_TIMEOUT_MS = 60_000;

async function writePlan(client: Tx, plan: ImportPlan, actor: AuditActor): Promise<void> {
  const audit = createPrismaAuditScope(client);
  const [{ now }] = await client.$queryRaw<Array<{ now: Date }>>`SELECT now() AS "now"`;
  const statuses = new Map(plan.items.map((item) => [`${item.kind}:${keyOf(item.label)}`, item.status]));
  const statusOf = (kind: ItemKind, label: string): ItemStatus => statuses.get(`${kind}:${keyOf(label)}`) ?? "equal";
  const personId = (email: string | null) => (email === null ? null : (plan.people.get(keyOf(email))?.id ?? null));
  const data: ConfigurationData = plan.data;

  /** Creates or updates one item with its audit entry; an equal item is left as it is. */
  async function save(
    entityType: AuditEntityType,
    status: ItemStatus,
    existingId: string | null,
    create: () => Promise<{ id: string }>,
    update: (id: string) => Promise<{ id: string }>,
  ): Promise<string | null> {
    if (status === "equal") return existingId;
    if (existingId === null) return (await audit.audited({ actor, action: "CREATED", entityType }, create)).id;
    await audit.audited({ actor, action: "UPDATED", entityType, entityId: existingId }, () => update(existingId));
    return existingId;
  }
  const idsByKey = (rows: Array<{ id: string; key: string }>) => new Map(rows.map((row) => [keyOf(row.key), row.id]));

  // Sectors and categories.
  const sectorIds = idsByKey((await client.sector.findMany({ select: { id: true, name: true } })).map(({ id, name }) => ({ id, key: name })));
  for (const sector of data.sectors) {
    const values = {
      name: sector.name,
      isActive: sector.isActive,
      escalateOverdue: sector.escalateOverdue,
      distributionMode: sector.distributionMode,
      maxActivePerAttendant: sector.maxActivePerAttendant,
      redistributeOnAbsence: sector.redistributeOnAbsence,
    };
    const id = await save(
      "SECTOR",
      statusOf("sector", sector.name),
      sectorIds.get(keyOf(sector.name)) ?? null,
      () => client.sector.create({ data: values, select: { id: true } }),
      (existing) => client.sector.update({ where: { id: existing }, data: values, select: { id: true } }),
    );
    if (id) sectorIds.set(keyOf(sector.name), id);
  }

  const categoryIds = idsByKey((await client.category.findMany({ select: { id: true, name: true } })).map(({ id, name }) => ({ id, key: name })));
  for (const category of data.categories) {
    const values = { name: category.name, isActive: category.isActive };
    const id = await save(
      "CATEGORY",
      statusOf("category", category.name),
      categoryIds.get(keyOf(category.name)) ?? null,
      () => client.category.create({ data: values, select: { id: true } }),
      (existing) => client.category.update({ where: { id: existing }, data: values, select: { id: true } }),
    );
    if (id) categoryIds.set(keyOf(category.name), id);
  }

  // Services, without the approval condition, which points to a field.
  const serviceIds = idsByKey((await client.service.findMany({ select: { id: true, name: true } })).map(({ id, name }) => ({ id, key: name })));
  for (const service of data.services) {
    const values = {
      name: service.name,
      description: service.description,
      categoryId: categoryIds.get(keyOf(service.category))!,
      sectorId: sectorIds.get(keyOf(service.sector))!,
      isActive: service.isActive,
      defaultPriority: service.defaultPriority,
      slaHours: service.slaHours,
      slaBusinessHours: service.slaBusinessHours,
      requiresApproval: service.requiresApproval,
      approvalSectorIds: service.approvalSectors.map((name) => sectorIds.get(keyOf(name))!),
      approvalDeadlineDays: service.approvalDeadlineDays,
    };
    const id = await save(
      "SERVICE",
      statusOf("service", service.name),
      serviceIds.get(keyOf(service.name)) ?? null,
      () => client.service.create({ data: values, select: { id: true } }),
      (existing) => client.service.update({ where: { id: existing }, data: values, select: { id: true } }),
    );
    if (id) serviceIds.set(keyOf(service.name), id);
  }

  for (const service of data.services) {
    const serviceId = serviceIds.get(keyOf(service.name))!;
    const owner = (kind: ItemKind, label: string) => statusOf(kind, pathOf(service.name, label));

    // Fields first without conditions, then the conditions (a controller may be new).
    const fieldRows = await client.serviceField.findMany({ where: { serviceId }, select: { id: true, label: true, conditionFieldId: true, conditionValue: true } });
    const fieldIds = idsByKey(fieldRows.map(({ id, label }) => ({ id, key: label })));
    for (const field of service.fields) {
      const values = {
        label: field.label,
        helpText: field.helpText,
        type: field.type,
        audience: field.audience,
        isRequired: field.isRequired,
        options: field.options,
        minValue: field.minValue,
        maxValue: field.maxValue,
        decimalPlaces: field.decimalPlaces,
        minDecimal: field.minDecimal,
        maxDecimal: field.maxDecimal,
        position: field.position,
        isActive: field.isActive,
      };
      const id = await save(
        "SERVICE_FIELD",
        owner("field", field.label),
        fieldIds.get(keyOf(field.label)) ?? null,
        () => client.serviceField.create({ data: { ...values, serviceId }, select: { id: true } }),
        (existing) => client.serviceField.update({ where: { id: existing }, data: values, select: { id: true } }),
      );
      if (id) fieldIds.set(keyOf(field.label), id);
    }
    const currentConditions = new Map(fieldRows.map((row) => [row.id, row]));
    const conditionOf = (condition: { field: string; value: string } | null) =>
      condition ? { conditionFieldId: fieldIds.get(keyOf(condition.field))!, conditionValue: condition.value } : { conditionFieldId: null, conditionValue: null };
    for (const field of service.fields) {
      const id = fieldIds.get(keyOf(field.label))!;
      const wanted = conditionOf(field.condition);
      const current = currentConditions.get(id);
      if ((current?.conditionFieldId ?? null) === wanted.conditionFieldId && (current?.conditionValue ?? null) === wanted.conditionValue) continue;
      await audit.audited({ actor, action: "UPDATED", entityType: "SERVICE_FIELD", entityId: id }, () =>
        client.serviceField.update({ where: { id }, data: wanted, select: { id: true } }),
      );
    }

    // The approval condition, now that the fields exist.
    if (statusOf("service", service.name) !== "equal") {
      const current = await client.service.findUniqueOrThrow({ where: { id: serviceId }, select: { approvalConditionFieldId: true, approvalConditionValue: true } });
      const wanted = service.approvalCondition
        ? { approvalConditionFieldId: fieldIds.get(keyOf(service.approvalCondition.field))!, approvalConditionValue: service.approvalCondition.value }
        : { approvalConditionFieldId: null, approvalConditionValue: null };
      if (current.approvalConditionFieldId !== wanted.approvalConditionFieldId || current.approvalConditionValue !== wanted.approvalConditionValue) {
        await audit.audited({ actor, action: "UPDATED", entityType: "SERVICE", entityId: serviceId }, () =>
          client.service.update({ where: { id: serviceId }, data: wanted, select: { id: true } }),
        );
      }
    }

    const documentIds = idsByKey(
      (await client.serviceDocumentRequirement.findMany({ where: { serviceId }, select: { id: true, name: true } })).map(({ id, name }) => ({ id, key: name })),
    );
    for (const document of service.documents) {
      const values = { name: document.name, isRequired: document.isRequired, acceptedFormats: document.acceptedFormats, position: document.position, isActive: document.isActive };
      await save(
        "DOCUMENT_REQUIREMENT",
        owner("document", document.name),
        documentIds.get(keyOf(document.name)) ?? null,
        () => client.serviceDocumentRequirement.create({ data: { ...values, serviceId }, select: { id: true } }),
        (existing) => client.serviceDocumentRequirement.update({ where: { id: existing }, data: values, select: { id: true } }),
      );
    }

    const stageIds = idsByKey((await client.serviceStage.findMany({ where: { serviceId }, select: { id: true, name: true } })).map(({ id, name }) => ({ id, key: name })));
    for (const stage of service.stages) {
      const values = {
        name: stage.name,
        position: stage.position,
        isActive: stage.isActive,
        assigneeId: personId(stage.assignee),
        targetDays: stage.targetDays,
        ...conditionOf(stage.condition),
      };
      await save(
        "SERVICE_STAGE",
        owner("stage", stage.name),
        stageIds.get(keyOf(stage.name)) ?? null,
        () => client.serviceStage.create({ data: { ...values, serviceId }, select: { id: true } }),
        (existing) => client.serviceStage.update({ where: { id: existing }, data: values, select: { id: true } }),
      );
    }

    const articleIds = idsByKey((await client.knowledgeArticle.findMany({ where: { serviceId }, select: { id: true, title: true } })).map(({ id, title }) => ({ id, key: title })));
    for (const article of service.articles) {
      const values = { title: article.title, body: article.body, isPublished: article.isPublished, position: article.position, updatedById: actor.id, updatedAt: now };
      await save(
        "KNOWLEDGE_ARTICLE",
        owner("article", article.title),
        articleIds.get(keyOf(article.title)) ?? null,
        () => client.knowledgeArticle.create({ data: { ...values, serviceId, createdById: actor.id, createdAt: now }, select: { id: true } }),
        (existing) => client.knowledgeArticle.update({ where: { id: existing }, data: values, select: { id: true } }),
      );
    }
  }

  // The sectors' escalation rules and canned responses.
  for (const sector of data.sectors) {
    const sectorId = sectorIds.get(keyOf(sector.name))!;
    const ruleIds = idsByKey((await client.sectorEscalationRule.findMany({ where: { sectorId }, select: { id: true, name: true } })).map(({ id, name }) => ({ id, key: name })));
    for (const rule of sector.escalationRules) {
      const values = {
        name: rule.name,
        trigger: rule.trigger,
        overdueDays: rule.overdueDays,
        raisePriority: rule.raisePriority,
        assignToId: personId(rule.assignTo),
        notifyManagers: rule.notifyManagers,
        notifyTeam: rule.notifyTeam,
        notifyUserIds: rule.notify.map(personId).filter((id): id is string => id !== null),
        isActive: rule.isActive,
      };
      await save(
        "ESCALATION_RULE",
        statusOf("escalationRule", pathOf(sector.name, rule.name)),
        ruleIds.get(keyOf(rule.name)) ?? null,
        () => client.sectorEscalationRule.create({ data: { ...values, sectorId }, select: { id: true } }),
        (existing) => client.sectorEscalationRule.update({ where: { id: existing }, data: values, select: { id: true } }),
      );
    }

    const responses = idsByKey((await client.cannedResponse.findMany({ where: { sectorId }, select: { id: true, title: true } })).map(({ id, title }) => ({ id, key: title })));
    for (const response of sector.cannedResponses) {
      if (statusOf("cannedResponse", pathOf(sector.name, response.title)) === "equal") continue;
      const values = { title: response.title, body: response.body, isActive: response.isActive, updatedById: actor.id, updatedAt: now };
      const existing = responses.get(keyOf(response.title));
      if (existing) await client.cannedResponse.update({ where: { id: existing }, data: values });
      else await client.cannedResponse.create({ data: { ...values, sectorId, createdById: actor.id, createdAt: now } });
    }
  }

  // Access roles.
  const roleIds = idsByKey((await client.accessRole.findMany({ select: { id: true, name: true } })).map(({ id, name }) => ({ id, key: name })));
  for (const role of data.accessRoles) {
    const values = { name: role.name, description: role.description, permissions: role.permissions, isActive: role.isActive };
    await save(
      "ACCESS_ROLE",
      statusOf("accessRole", role.name),
      roleIds.get(keyOf(role.name)) ?? null,
      () => client.accessRole.create({ data: values, select: { id: true } }),
      (existing) => client.accessRole.update({ where: { id: existing }, data: values, select: { id: true } }),
    );
  }

  // The calendar has one row; its audit entry has a fixed id, as on its screen.
  if (data.calendar && statusOf("calendar", "Calendário") !== "equal") {
    const settings = parseCalendarInput(data.calendar);
    await audit.audited({ actor, action: "UPDATED", entityType: "BUSINESS_CALENDAR", entityId: BUSINESS_CALENDAR_AUDIT_ID }, async () => {
      const values = { ...settings, updatedAt: now, updatedById: actor.id };
      await client.businessCalendar.upsert({ where: { id: 1 }, create: { id: 1, ...values }, update: values });
      return { id: BUSINESS_CALENDAR_AUDIT_ID };
    });
  }

  const holidayIds = new Map(
    (await client.businessHoliday.findMany({ select: { id: true, day: true } })).map(({ id, day }) => [day.toISOString().slice(0, 10), id]),
  );
  for (const holiday of data.holidays) {
    await save(
      "HOLIDAY",
      statusOf("holiday", `${holiday.day} ${holiday.name}`),
      holidayIds.get(holiday.day) ?? null,
      () => client.businessHoliday.create({ data: { day: dateOf(holiday.day), name: holiday.name, yearly: holiday.yearly, createdById: actor.id }, select: { id: true } }),
      (existing) => client.businessHoliday.update({ where: { id: existing }, data: { name: holiday.name, yearly: holiday.yearly }, select: { id: true } }),
    );
  }

  // Bundles, by their services' names, in the bundle's order.
  const bundleIds = idsByKey((await client.serviceBundle.findMany({ select: { id: true, name: true } })).map(({ id, name }) => ({ id, key: name })));
  for (const bundle of data.bundles) {
    const values = {
      name: bundle.name,
      description: bundle.description,
      serviceIds: bundle.services.map((name) => serviceIds.get(keyOf(name))!),
      isActive: bundle.isActive,
    };
    await save(
      "SERVICE_BUNDLE",
      statusOf("bundle", bundle.name),
      bundleIds.get(keyOf(bundle.name)) ?? null,
      () => client.serviceBundle.create({ data: values, select: { id: true } }),
      (existing) => client.serviceBundle.update({ where: { id: existing }, data: values, select: { id: true } }),
    );
  }
}

function transactionOf(client: Tx): ConfigurationApplyTransaction {
  return {
    snapshot: () => readSnapshot(client),
    facts: () => readFacts(client),
    people: (emails) => readPeople(client, emails),
    write: (plan, actor) => writePlan(client, plan, actor),
    async recordImport(actor, summary) {
      const entry = planAuditEntry(
        { actor, action: "IMPORTED", entityType: "CONFIGURATION", entityId: CONFIGURATION_ENTITY_ID, entityLabel: CONFIGURATION_ENTITY_LABEL },
        null,
        { itemsCreated: summary.new, itemsUpdated: summary.changed, itemsUnchanged: summary.equal },
      );
      if (entry) await client.auditEntry.create({ data: { ...entry, changes: entry.changes as unknown as Prisma.InputJsonValue } });
    },
  };
}

export function createPrismaConfigurationApplyStore(database: PrismaClient): ConfigurationApplyStore {
  return {
    run(work) {
      return runSerializableTransaction(database, (client) => work(transactionOf(client)), {
        translate: ["P2002", "P2003", "P2025", "P2034"],
        fallbackMessage: "Configuration import failed.",
      }, { timeoutMs: APPLY_TIMEOUT_MS });
    },
  };
}
