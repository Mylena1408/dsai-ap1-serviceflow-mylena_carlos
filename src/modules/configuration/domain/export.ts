import { timeOfMinute } from "@/shared/business-clock";
import {
  CONFIGURATION_FORMAT,
  CONFIGURATION_VERSION,
  keyOf,
  type ConfigurationData,
  type ConfigurationFile,
  type FieldItem,
} from "./format";

// Building the exported file (SPEC 2026-11-07-operacao-e-automacao, 6.3 items 2 and 3) from the rows as
// stored: internal identifiers become names, labels and e-mails; the order is fixed, so the same
// configuration always gives the same data.

type Priority = ConfigurationData["services"][number]["defaultPriority"];

export interface ConfigurationSnapshot {
  sectors: Array<{
    id: string;
    name: string;
    isActive: boolean;
    escalateOverdue: boolean;
    distributionMode: ConfigurationData["sectors"][number]["distributionMode"];
    maxActivePerAttendant: number | null;
    redistributeOnAbsence: boolean;
  }>;
  escalationRules: Array<{
    sectorId: string;
    name: string;
    trigger: ConfigurationData["sectors"][number]["escalationRules"][number]["trigger"];
    overdueDays: number | null;
    raisePriority: boolean;
    assignToId: string | null;
    notifyManagers: boolean;
    notifyTeam: boolean;
    notifyUserIds: string[];
    isActive: boolean;
  }>;
  cannedResponses: Array<{ sectorId: string; title: string; body: string; isActive: boolean }>;
  categories: Array<{ id: string; name: string; isActive: boolean }>;
  services: Array<{
    id: string;
    name: string;
    description: string;
    categoryId: string;
    sectorId: string;
    isActive: boolean;
    defaultPriority: Priority;
    slaHours: number | null;
    slaBusinessHours: boolean;
    requiresApproval: boolean;
    approvalSectorIds: string[];
    approvalConditionFieldId: string | null;
    approvalConditionValue: string | null;
    approvalDeadlineDays: number | null;
  }>;
  fields: Array<
    Omit<FieldItem, "condition"> & { id: string; serviceId: string; conditionFieldId: string | null; conditionValue: string | null }
  >;
  documents: Array<{ serviceId: string; name: string; isRequired: boolean; acceptedFormats: Array<"PDF" | "DOCX" | "TXT">; position: number; isActive: boolean }>;
  stages: Array<{
    serviceId: string;
    name: string;
    position: number;
    isActive: boolean;
    assigneeId: string | null;
    targetDays: number | null;
    conditionFieldId: string | null;
    conditionValue: string | null;
  }>;
  articles: Array<{ serviceId: string; title: string; body: string; isPublished: boolean; position: number }>;
  accessRoles: Array<{ name: string; description: string | null; permissions: ConfigurationData["accessRoles"][number]["permissions"]; isActive: boolean }>;
  calendar: { weekdays: number[]; startMinute: number; endMinute: number; timeZone: string } | null;
  holidays: Array<{ day: string; name: string; yearly: boolean }>;
  bundles: Array<{ name: string; description: string | null; serviceIds: string[]; isActive: boolean }>;
  /** The e-mail of each person the configuration refers to, by id. */
  emails: Record<string, string>;
}

/** By key, then as read (a stable sort keeps the reader's order between equal keys). */
const byKey = <T>(key: (item: T) => string) => (a: T, b: T) => keyOf(key(a)).localeCompare(keyOf(key(b)), "pt-BR");
const byPosition = <T extends { position: number }>(key: (item: T) => string) => (a: T, b: T) =>
  a.position - b.position || byKey(key)(a, b);

export function buildConfigurationData(snapshot: ConfigurationSnapshot): ConfigurationData {
  const sectorName = new Map(snapshot.sectors.map((sector) => [sector.id, sector.name]));
  const categoryName = new Map(snapshot.categories.map((category) => [category.id, category.name]));
  const serviceName = new Map(snapshot.services.map((service) => [service.id, service.name]));
  const fieldLabel = new Map(snapshot.fields.map((field) => [field.id, field.label]));
  const emailOf = (userId: string | null) => (userId === null ? null : (snapshot.emails[userId] ?? null));
  // A reference to something that no longer exists is left out.
  const present = <T>(value: T | null | undefined): value is T => value !== null && value !== undefined;
  const condition = (fieldId: string | null, value: string | null) => {
    const label = fieldId === null ? undefined : fieldLabel.get(fieldId);
    return label !== undefined && value !== null ? { field: label, value } : null;
  };
  const ofService = <T extends { serviceId: string }>(items: readonly T[], serviceId: string) => items.filter((item) => item.serviceId === serviceId);
  const ofSector = <T extends { sectorId: string }>(items: readonly T[], sectorId: string) => items.filter((item) => item.sectorId === sectorId);

  return {
    sectors: [...snapshot.sectors].sort(byKey((sector) => sector.name)).map((sector) => ({
      name: sector.name,
      isActive: sector.isActive,
      escalateOverdue: sector.escalateOverdue,
      distributionMode: sector.distributionMode,
      maxActivePerAttendant: sector.maxActivePerAttendant,
      redistributeOnAbsence: sector.redistributeOnAbsence,
      escalationRules: ofSector(snapshot.escalationRules, sector.id)
        .sort(byKey((rule) => rule.name))
        .map((rule) => ({
          name: rule.name,
          trigger: rule.trigger,
          overdueDays: rule.overdueDays,
          raisePriority: rule.raisePriority,
          assignTo: emailOf(rule.assignToId),
          notifyManagers: rule.notifyManagers,
          notifyTeam: rule.notifyTeam,
          notify: rule.notifyUserIds.map(emailOf).filter(present).sort(),
          isActive: rule.isActive,
        })),
      cannedResponses: ofSector(snapshot.cannedResponses, sector.id)
        .sort(byKey((response) => response.title))
        .map(({ title, body, isActive }) => ({ title, body, isActive })),
    })),
    categories: [...snapshot.categories].sort(byKey((category) => category.name)).map(({ name, isActive }) => ({ name, isActive })),
    services: [...snapshot.services].sort(byKey((service) => service.name)).map((service) => ({
      name: service.name,
      description: service.description,
      category: categoryName.get(service.categoryId) ?? "",
      sector: sectorName.get(service.sectorId) ?? "",
      isActive: service.isActive,
      defaultPriority: service.defaultPriority,
      slaHours: service.slaHours,
      slaBusinessHours: service.slaBusinessHours,
      requiresApproval: service.requiresApproval,
      approvalSectors: service.approvalSectorIds.map((id) => sectorName.get(id)).filter(present),
      approvalCondition: condition(service.approvalConditionFieldId, service.approvalConditionValue),
      approvalDeadlineDays: service.approvalDeadlineDays,
      fields: ofService(snapshot.fields, service.id)
        .sort(byPosition((field) => field.label))
        .map((field) => ({
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
          condition: condition(field.conditionFieldId, field.conditionValue),
        })),
      documents: ofService(snapshot.documents, service.id)
        .sort(byPosition((document) => document.name))
        .map(({ name, isRequired, acceptedFormats, position, isActive }) => ({ name, isRequired, acceptedFormats: [...acceptedFormats].sort(), position, isActive })),
      stages: ofService(snapshot.stages, service.id)
        .sort(byPosition((stage) => stage.name))
        .map((stage) => ({
          name: stage.name,
          position: stage.position,
          isActive: stage.isActive,
          assignee: emailOf(stage.assigneeId),
          targetDays: stage.targetDays,
          condition: condition(stage.conditionFieldId, stage.conditionValue),
        })),
      articles: ofService(snapshot.articles, service.id)
        .sort(byPosition((article) => article.title))
        .map(({ title, body, isPublished, position }) => ({ title, body, isPublished, position })),
    })),
    accessRoles: [...snapshot.accessRoles]
      .sort(byKey((role) => role.name))
      .map(({ name, description, permissions, isActive }) => ({ name, description, permissions: [...permissions].sort(), isActive })),
    calendar: snapshot.calendar && {
      weekdays: [...snapshot.calendar.weekdays].sort((a, b) => a - b),
      startTime: timeOfMinute(snapshot.calendar.startMinute),
      endTime: timeOfMinute(snapshot.calendar.endMinute),
      timeZone: snapshot.calendar.timeZone,
    },
    holidays: [...snapshot.holidays].sort((a, b) => a.day.localeCompare(b.day)).map(({ day, name, yearly }) => ({ day, name, yearly })),
    bundles: [...snapshot.bundles].sort(byKey((bundle) => bundle.name)).map((bundle) => ({
      name: bundle.name,
      description: bundle.description,
      // The bundle's order is the opening's order: kept as stored.
      services: bundle.serviceIds.map((id) => serviceName.get(id)).filter(present),
      isActive: bundle.isActive,
    })),
  };
}

export function buildConfigurationFile(snapshot: ConfigurationSnapshot, exportedAt: Date): ConfigurationFile {
  return { format: CONFIGURATION_FORMAT, version: CONFIGURATION_VERSION, exportedAt: exportedAt.toISOString(), data: buildConfigurationData(snapshot) };
}

/** "serviceflow-configuracao-2026-11-07.json". */
export function configurationFileName(exportedAt: Date): string {
  return `serviceflow-configuracao-${exportedAt.toISOString().slice(0, 10)}.json`;
}
