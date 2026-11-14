import { z } from "zod";

// The portable configuration file (SPEC 2026-11-07-operacao-e-automacao, 6.3 items 2 and 3; decisions H13
// and H14): {"format": "serviceflow-config", "version": 2, "exportedAt": …, "data": {…}}, at most 2 MB,
// without internal identifiers. Items refer to each other by name (sector, category, service) and, inside a
// service, by label or name (field, stage); people by e-mail. This schema checks the shape; the rules of each
// configuration screen are checked by the import's preview (SF-188).
//
// Version 2 (SPEC 2026-11-08-atendimento-dia-a-dia, 9.1 item 1; decision I19) also carries each sector's tags
// and each service's checklist model. The import accepts both versions: a version 1 file has neither list and
// leaves the destination's tags and checklists as they are; a version 2 file has both lists in every sector
// and service.

export const CONFIGURATION_FORMAT = "serviceflow-config";
/** The version the export writes. */
export const CONFIGURATION_VERSION = 2;
/** The versions the import accepts. */
export const CONFIGURATION_VERSIONS = [1, 2] as const;
export const MAX_CONFIGURATION_BYTES = 2 * 1024 * 1024;

// Generous bounds that only stop abuse; the screens' limits are checked by the preview. Lists also hold the
// inactive items, which may go past the screens' limits for active ones.
const text = (max: number) => z.string().max(max);
const name = text(200);
const email = text(320);
const list = <T extends z.ZodTypeAny>(item: T, max: number) => z.array(item).max(max);

const conditionSchema = z.object({ field: name, value: text(200) }).strict();

const escalationRuleSchema = z
  .object({
    name,
    trigger: z.enum(["OVERDUE", "DUE_SOON", "OVERDUE_DAYS"]),
    overdueDays: z.number().int().nullable(),
    raisePriority: z.boolean(),
    assignTo: email.nullable(),
    notifyManagers: z.boolean(),
    notifyTeam: z.boolean(),
    notify: list(email, 50),
    isActive: z.boolean(),
  })
  .strict();

const cannedResponseSchema = z.object({ title: name, body: text(20_000), isActive: z.boolean() }).strict();

/** Version 2: the color by its palette key ("blue"); the screen's palette is checked by the preview. */
const tagSchema = z.object({ name, color: text(40), isActive: z.boolean() }).strict();

const sectorSchema = z
  .object({
    name,
    isActive: z.boolean(),
    escalateOverdue: z.boolean(),
    distributionMode: z.enum(["NONE", "ROUND_ROBIN", "LEAST_LOAD"]),
    maxActivePerAttendant: z.number().int().nullable(),
    redistributeOnAbsence: z.boolean(),
    escalationRules: list(escalationRuleSchema, 500),
    cannedResponses: list(cannedResponseSchema, 2_000),
    /** Version 2 only. */
    tags: list(tagSchema, 1_000).optional(),
  })
  .strict();

const categorySchema = z.object({ name, isActive: z.boolean() }).strict();

const fieldSchema = z
  .object({
    label: name,
    helpText: text(2_000).nullable(),
    type: z.enum(["SHORT_TEXT", "LONG_TEXT", "INTEGER", "DATE", "SELECT", "YES_NO", "MULTI_SELECT", "DECIMAL", "EMAIL", "PHONE", "CPF", "CNPJ", "CEP"]),
    audience: z.enum(["REQUESTER", "ATTENDANT"]),
    isRequired: z.boolean(),
    options: list(text(200), 100),
    minValue: z.number().int().nullable(),
    maxValue: z.number().int().nullable(),
    decimalPlaces: z.number().int().nullable(),
    /** Decimal limits as text with the field's places ("10.50"). */
    minDecimal: text(40).nullable(),
    maxDecimal: text(40).nullable(),
    position: z.number().int(),
    isActive: z.boolean(),
    condition: conditionSchema.nullable(),
  })
  .strict();

const documentSchema = z
  .object({
    name,
    isRequired: z.boolean(),
    acceptedFormats: list(z.enum(["PDF", "DOCX", "TXT"]), 3),
    position: z.number().int(),
    isActive: z.boolean(),
  })
  .strict();

const stageSchema = z
  .object({
    name,
    position: z.number().int(),
    isActive: z.boolean(),
    assignee: email.nullable(),
    targetDays: z.number().int().nullable(),
    condition: conditionSchema.nullable(),
  })
  .strict();

/** Version 2: an item of the checklist model; the condition by the field's label, as the stages'. */
const checklistItemSchema = z
  .object({
    text: text(2_000),
    isRequired: z.boolean(),
    position: z.number().int(),
    isActive: z.boolean(),
    condition: conditionSchema.nullable(),
  })
  .strict();

const articleSchema = z.object({ title: name, body: text(50_000), isPublished: z.boolean(), position: z.number().int() }).strict();

const serviceSchema = z
  .object({
    name,
    description: text(10_000),
    category: name,
    sector: name,
    isActive: z.boolean(),
    defaultPriority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
    slaHours: z.number().int().nullable(),
    slaBusinessHours: z.boolean(),
    requiresApproval: z.boolean(),
    /** The approval levels' sectors, by name; empty means the service's own sector. */
    approvalSectors: list(name, 10),
    approvalCondition: conditionSchema.nullable(),
    approvalDeadlineDays: z.number().int().nullable(),
    fields: list(fieldSchema, 500),
    documents: list(documentSchema, 200),
    stages: list(stageSchema, 200),
    articles: list(articleSchema, 500),
    /** Version 2 only. */
    checklist: list(checklistItemSchema, 500).optional(),
  })
  .strict();

const accessRoleSchema = z
  .object({
    name,
    description: text(2_000).nullable(),
    permissions: list(z.enum(["SECTOR_SERVICES", "SECTOR_REQUESTS_READ", "QUEUE_SUPERVISION"]), 3),
    isActive: z.boolean(),
  })
  .strict();

const calendarSchema = z
  .object({
    weekdays: list(z.number().int(), 7),
    /** "HH:MM", as the calendar screen shows it. */
    startTime: text(5),
    endTime: text(5),
    timeZone: text(100),
  })
  .strict();

const holidaySchema = z.object({ day: text(10), name, yearly: z.boolean() }).strict();

const bundleSchema = z
  .object({ name, description: text(2_000).nullable(), services: list(name, 20), isActive: z.boolean() })
  .strict();

export const configurationDataSchema = z
  .object({
    sectors: list(sectorSchema, 1_000),
    categories: list(categorySchema, 1_000),
    services: list(serviceSchema, 5_000),
    accessRoles: list(accessRoleSchema, 1_000),
    calendar: calendarSchema.nullable(),
    holidays: list(holidaySchema, 5_000),
    bundles: list(bundleSchema, 1_000),
  })
  .strict();

export const configurationFileSchema = z
  .object({
    format: z.literal(CONFIGURATION_FORMAT),
    version: z.literal(CONFIGURATION_VERSIONS),
    exportedAt: z.string().max(40),
    data: configurationDataSchema,
  })
  .strict()
  .superRefine((file, context) => {
    // Version 1 never has the tags and the checklists; version 2 always has them.
    const v2 = file.version === 2;
    const expect = (present: boolean, path: Array<string | number>) => {
      if (present === v2) return;
      context.addIssue({
        code: "custom",
        path: ["data", ...path],
        message: v2 ? "Version 2 needs this list." : "Version 1 does not have this list.",
      });
    };
    file.data.sectors.forEach((sector, index) => expect(sector.tags !== undefined, ["sectors", index, "tags"]));
    file.data.services.forEach((service, index) => expect(service.checklist !== undefined, ["services", index, "checklist"]));
  });

export type ConfigurationFile = z.infer<typeof configurationFileSchema>;
export type ConfigurationData = ConfigurationFile["data"];
export type SectorItem = ConfigurationData["sectors"][number];
export type ServiceItem = ConfigurationData["services"][number];
export type FieldItem = ServiceItem["fields"][number];
export type StageItem = ServiceItem["stages"][number];
export type TagItem = NonNullable<SectorItem["tags"]>[number];
export type ChecklistItem = NonNullable<ServiceItem["checklist"]>[number];

/** How a key is compared: the database compares these names ignoring case (citext). */
export const keyOf = (value: string) => value.trim().toLocaleLowerCase("pt-BR");

/**
 * Keys repeated within the same scope (decision H14 matches by name; a repeated name cannot be matched).
 * Each entry reads as "serviços: Troca de lâmpada" or "Manutenção › campos: Sala".
 */
export function repeatedKeys(data: ConfigurationData): string[] {
  const repeated: string[] = [];
  const check = (scope: string, keys: readonly string[]) => {
    const seen = new Set<string>();
    const reported = new Set<string>();
    for (const key of keys) {
      const normalized = keyOf(key);
      if (seen.has(normalized) && !reported.has(normalized)) {
        repeated.push(`${scope}: ${key}`);
        reported.add(normalized);
      }
      seen.add(normalized);
    }
  };

  check("setores", data.sectors.map((sector) => sector.name));
  check("categorias", data.categories.map((category) => category.name));
  check("serviços", data.services.map((service) => service.name));
  check("papéis", data.accessRoles.map((role) => role.name));
  check("pacotes", data.bundles.map((bundle) => bundle.name));
  check("feriados", data.holidays.map((holiday) => holiday.day));
  for (const sector of data.sectors) {
    check(`${sector.name} › regras de escalonamento`, sector.escalationRules.map((rule) => rule.name));
    check(`${sector.name} › respostas prontas`, sector.cannedResponses.map((response) => response.title));
    check(`${sector.name} › etiquetas`, (sector.tags ?? []).map((tag) => tag.name));
  }
  for (const service of data.services) {
    check(`${service.name} › campos`, service.fields.map((field) => field.label));
    check(`${service.name} › documentos`, service.documents.map((document) => document.name));
    check(`${service.name} › etapas`, service.stages.map((stage) => stage.name));
    check(`${service.name} › artigos`, service.articles.map((article) => article.title));
    check(`${service.name} › checklist`, (service.checklist ?? []).map((item) => item.text));
  }
  return repeated;
}
