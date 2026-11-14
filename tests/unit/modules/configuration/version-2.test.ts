import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/authorization", () => ({
  requireConfigurationAdministrator: vi.fn(async () => ({ id: "adm", role: "ADMIN", isActive: true, sectorId: null })),
}));

import {
  CONFIGURATION_VERSION,
  buildConfigurationData,
  configurationFileSchema,
  repeatedKeys,
  type ConfigurationData,
  type ConfigurationSnapshot,
} from "@/modules/configuration";
import { classifyItems, keyProblems } from "@/modules/configuration/domain/preview";
import { validateConfiguration, type DestinationFacts } from "@/modules/configuration/domain/validation";
import { previewConfigurationImport, type ConfigurationImportStore } from "@/modules/configuration/application/preview-import";

// SPEC 2026-11-08-atendimento-dia-a-dia, 9.1 item 1 (SF-220; decision I19; CA-CMP-01 by the rules): the file's
// version 2 carries the sectors' tags and the services' checklist models; version 1 is still accepted.

type Service = ConfigurationData["services"][number];
type Sector = ConfigurationData["sectors"][number];
type Tag = NonNullable<Sector["tags"]>[number];
type Item = NonNullable<Service["checklist"]>[number];

const tag = (overrides: Partial<Tag> = {}): Tag => ({ name: "Urgente", color: "red", isActive: true, ...overrides });
const item = (overrides: Partial<Item> = {}): Item => ({ text: "Conferir backup", isRequired: true, position: 1, isActive: true, condition: null, ...overrides });

const sector = (overrides: Partial<Sector> = {}): Sector => ({
  name: "TI",
  isActive: true,
  escalateOverdue: false,
  distributionMode: "NONE",
  maxActivePerAttendant: null,
  redistributeOnAbsence: false,
  escalationRules: [],
  cannedResponses: [],
  tags: [tag()],
  ...overrides,
});

const service = (overrides: Partial<Service> = {}): Service => ({
  name: "Acesso a sistema",
  description: "Libera o acesso",
  category: "Acesso",
  sector: "TI",
  isActive: true,
  defaultPriority: "NORMAL",
  slaHours: 8,
  slaBusinessHours: false,
  requiresApproval: false,
  approvalSectors: [],
  approvalCondition: null,
  approvalDeadlineDays: null,
  fields: [
    {
      label: "Sistema",
      helpText: null,
      type: "SELECT",
      audience: "REQUESTER",
      isRequired: true,
      options: ["ERP", "CRM"],
      minValue: null,
      maxValue: null,
      decimalPlaces: null,
      minDecimal: null,
      maxDecimal: null,
      position: 1,
      isActive: true,
      condition: null,
    },
  ],
  documents: [],
  stages: [],
  articles: [],
  checklist: [item(), item({ text: "Testar acesso", isRequired: false, position: 2, condition: { field: "Sistema", value: "ERP" } })],
  ...overrides,
});

const data = (): ConfigurationData => ({
  sectors: [sector()],
  categories: [{ name: "Acesso", isActive: true }],
  services: [service()],
  accessRoles: [],
  calendar: null,
  holidays: [],
  bundles: [],
});

/** The same data as a version 1 file carries it: without tags and checklists. */
const withoutVersion2 = (content: ConfigurationData): ConfigurationData => ({
  ...content,
  sectors: content.sectors.map((sector) => {
    const copy = { ...sector };
    delete copy.tags;
    return copy;
  }),
  services: content.services.map((service) => {
    const copy = { ...service };
    delete copy.checklist;
    return copy;
  }),
});

const fileOf = (version: number, content: ConfigurationData) => ({ format: "serviceflow-config", version, exportedAt: "2026-11-09T10:00:00.000Z", data: content });
const facts: DestinationFacts = { sectorsWithPendingRequests: [], sectorsWithActiveAttendants: [] };
const empty = (): ConfigurationData => ({ sectors: [], categories: [], services: [], accessRoles: [], calendar: null, holidays: [], bundles: [] });

describe("the format's versions (decision I19)", () => {
  it("exports version 2; accepts version 1 without the new lists and version 2 with them", () => {
    expect(CONFIGURATION_VERSION).toBe(2);
    expect(configurationFileSchema.safeParse(fileOf(2, data())).success).toBe(true);
    expect(configurationFileSchema.safeParse(fileOf(1, withoutVersion2(data()))).success).toBe(true);
  });

  it("refuses version 1 with the new lists and version 2 without them, naming where", () => {
    const paths = (file: unknown) => {
      const result = configurationFileSchema.safeParse(file);
      return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
    };
    expect(paths(fileOf(1, data()))).toEqual(["data.sectors.0.tags", "data.services.0.checklist"]);
    expect(paths(fileOf(2, withoutVersion2(data())))).toEqual(["data.sectors.0.tags", "data.services.0.checklist"]);
    expect(paths(fileOf(3, data()))).toEqual(["version"]);
  });
});

describe("the exported tags and checklists", () => {
  const ids = { ti: "11111111-1111-4111-8111-111111111111", cat: "33333333-3333-4333-8333-333333333333", access: "44444444-4444-4444-8444-444444444444", system: "66666666-6666-4666-8666-666666666666" };
  const snapshot = (): ConfigurationSnapshot => ({
    sectors: [{ id: ids.ti, name: "TI", isActive: true, escalateOverdue: false, distributionMode: "NONE", maxActivePerAttendant: null, redistributeOnAbsence: false }],
    escalationRules: [],
    cannedResponses: [],
    tags: [
      { sectorId: ids.ti, name: "Urgente", color: "red", isActive: true },
      { sectorId: ids.ti, name: "aguardando peça", color: "yellow", isActive: false },
    ],
    categories: [{ id: ids.cat, name: "Acesso", isActive: true }],
    services: [
      {
        id: ids.access,
        name: "Acesso a sistema",
        description: "",
        categoryId: ids.cat,
        sectorId: ids.ti,
        isActive: true,
        defaultPriority: "NORMAL",
        slaHours: null,
        slaBusinessHours: false,
        requiresApproval: false,
        approvalSectorIds: [],
        approvalConditionFieldId: null,
        approvalConditionValue: null,
        approvalDeadlineDays: null,
      },
    ],
    fields: [
      {
        id: ids.system,
        serviceId: ids.access,
        label: "Sistema",
        helpText: null,
        type: "SELECT",
        audience: "REQUESTER",
        isRequired: true,
        options: ["ERP"],
        minValue: null,
        maxValue: null,
        decimalPlaces: null,
        minDecimal: null,
        maxDecimal: null,
        position: 1,
        isActive: true,
        conditionFieldId: null,
        conditionValue: null,
      },
    ],
    documents: [],
    stages: [],
    articles: [],
    checklistItems: [
      { serviceId: ids.access, text: "Testar", isRequired: false, position: 2, isActive: true, conditionFieldId: ids.system, conditionValue: "ERP" },
      { serviceId: ids.access, text: "Conferir", isRequired: true, position: 2, isActive: true, conditionFieldId: null, conditionValue: null },
      { serviceId: ids.access, text: "Avisar", isRequired: true, position: 1, isActive: false, conditionFieldId: null, conditionValue: null },
    ],
    accessRoles: [],
    calendar: null,
    holidays: [],
    bundles: [],
    emails: {},
  });

  it("tags by name; checklist items by position, then text, with the condition by the field's label", () => {
    const exported = buildConfigurationData(snapshot());
    expect(exported.sectors[0].tags).toEqual([
      { name: "aguardando peça", color: "yellow", isActive: false },
      { name: "Urgente", color: "red", isActive: true },
    ]);
    expect(exported.services[0].checklist).toEqual([
      { text: "Avisar", isRequired: true, position: 1, isActive: false, condition: null },
      { text: "Conferir", isRequired: true, position: 2, isActive: true, condition: null },
      { text: "Testar", isRequired: false, position: 2, isActive: true, condition: { field: "Sistema", value: "ERP" } },
    ]);
    expect(JSON.stringify(exported)).not.toContain(ids.system);
  });

  it("repeated tag names and checklist texts are reported in their own scope", () => {
    const content = data();
    content.sectors[0].tags!.push(tag({ name: "URGENTE", isActive: false }));
    content.services[0].checklist!.push(item({ position: 3 }));
    expect(repeatedKeys(content)).toEqual(["TI › etiquetas: URGENTE", "Acesso a sistema › checklist: Conferir backup"]);
    expect(keyProblems(content, []).map(({ path }) => path)).toEqual(["TI › etiquetas: URGENTE", "Acesso a sistema › checklist: Conferir backup"]);
    // A version 1 file uses no key of these scopes.
    expect(keyProblems(withoutVersion2(data()), ["TI › etiquetas: Urgente"])).toEqual([]);
    expect(keyProblems(data(), ["TI › etiquetas: Urgente"]).map(({ path }) => path)).toEqual(["TI › etiquetas: Urgente"]);
  });
});

describe("classifying tags and checklist items", () => {
  it("each tag and checklist item is new, changed with its fields, or equal", () => {
    const file = data();
    file.sectors[0].tags = [tag({ color: "blue" }), tag({ name: "Aguardando", color: "gray" })];
    file.services[0].checklist = [item({ isRequired: false }), file.services[0].checklist![1]];

    const items = classifyItems(file, data());
    expect(items.filter((entry) => entry.kind === "tag" || entry.kind === "checklistItem")).toEqual([
      { kind: "tag", label: "TI › Urgente", status: "changed", changes: ["color"] },
      { kind: "tag", label: "TI › Aguardando", status: "new", changes: [] },
      { kind: "checklistItem", label: "Acesso a sistema › Conferir backup", status: "changed", changes: ["isRequired"] },
      { kind: "checklistItem", label: "Acesso a sistema › Testar acesso", status: "equal", changes: [] },
    ]);
    // The nested lists are never a change of the sector or the service.
    expect(items.find((entry) => entry.kind === "sector")).toMatchObject({ status: "equal" });
    expect(items.find((entry) => entry.kind === "service")).toMatchObject({ status: "equal" });
    expect(classifyItems(data(), data()).every((entry) => entry.status === "equal")).toBe(true);
  });

  it("a version 1 file has no tag or checklist item, and its sectors and services stay equal", () => {
    const items = classifyItems(withoutVersion2(data()), data());
    expect(items.some((entry) => entry.kind === "tag" || entry.kind === "checklistItem")).toBe(false);
    expect(items.every((entry) => entry.status === "equal")).toBe(true);
  });
});

describe("the screens' rules for tags and checklist items", () => {
  const problems = (file: ConfigurationData, destination: ConfigurationData = empty()) => validateConfiguration(file, destination, facts);
  const paths = (file: ConfigurationData, destination?: ConfigurationData) => problems(file, destination).map(({ path }) => path);

  it("accepts valid lists, anything equal to the destination and a version 1 file", () => {
    expect(paths(data())).toEqual([]);
    expect(paths(data(), data())).toEqual([]);
    expect(paths(withoutVersion2(data()), data())).toEqual([]);
  });

  it("refuses a color out of the palette, a long or untrimmed text and a bad position, naming where", () => {
    const file = data();
    file.sectors[0].tags = [tag({ color: "pink" }), tag({ name: "x".repeat(31) }), tag({ name: " Espera " })];
    file.services[0].checklist = [item({ text: "y".repeat(121) }), item({ text: "Conferir ", position: 0 })];
    expect(paths(file)).toEqual([
      "sectors › TI › tags › Urgente › color",
      `sectors › TI › tags › ${"x".repeat(31)} › name`,
      "sectors › TI › tags ›  Espera  › name",
      `services › Acesso a sistema › checklist › ${"y".repeat(121)} › text`,
      "services › Acesso a sistema › checklist › Conferir  › text",
      "services › Acesso a sistema › checklist › Conferir  › position",
    ]);
    expect(problems(file).every(({ message }) => message.length > 0)).toBe(true);
  });

  it("checks the conditions as the stages' and the limits of active items", () => {
    const file = data();
    file.services[0].checklist = [
      item({ condition: { field: "Sistema", value: "SAP" } }),
      item({ text: "Sem campo", isActive: false, condition: { field: "Inexistente", value: "ERP" } }),
      // Inactive with an existing field: kept as it is.
      item({ text: "Inativo", isActive: false, condition: { field: "Sistema", value: "Antigo" } }),
      item({ text: "Valor longo", condition: { field: "Sistema", value: "z".repeat(81) } }),
    ];
    expect(paths(file)).toEqual([
      "services › Acesso a sistema › checklist › Conferir backup › condition",
      "services › Acesso a sistema › checklist › Sem campo › condition",
      "services › Acesso a sistema › checklist › Valor longo › condition",
      "services › Acesso a sistema › checklist › Valor longo › condition",
    ]);

    const crowded = data();
    crowded.sectors[0].tags = Array.from({ length: 31 }, (_, index) => tag({ name: `Etiqueta ${index}` }));
    crowded.services[0].checklist = Array.from({ length: 21 }, (_, index) => item({ text: `Item ${index}`, position: index + 1 }));
    expect(paths(crowded)).toEqual(["sectors › TI › tags", "services › Acesso a sistema › checklist"]);
    // Inactive items do not count.
    crowded.sectors[0].tags[30].isActive = false;
    crowded.services[0].checklist[20].isActive = false;
    expect(paths(crowded)).toEqual([]);
  });

  it("the limits count the destination's items the file does not have", () => {
    const destination = data();
    destination.sectors[0].tags = Array.from({ length: 30 }, (_, index) => tag({ name: `Etiqueta ${index}` }));
    const file = data();
    file.sectors[0].tags = [tag({ name: "Nova" })];
    expect(paths(file, destination)).toEqual(["sectors › TI › tags"]);
  });
});

describe("the preview of a version 2 file", () => {
  const snapshot: ConfigurationSnapshot = {
    sectors: [],
    escalationRules: [],
    cannedResponses: [],
    tags: [],
    categories: [],
    services: [],
    fields: [],
    documents: [],
    stages: [],
    articles: [],
    checklistItems: [],
    accessRoles: [],
    calendar: null,
    holidays: [],
    bundles: [],
    emails: {},
  };
  const store = (): ConfigurationImportStore => ({
    snapshot: vi.fn(async () => snapshot),
    facts: vi.fn(async () => facts),
    people: vi.fn(async () => []),
  });

  it("classifies the new items with their labels", async () => {
    const result = await previewConfigurationImport(JSON.stringify(fileOf(2, data())), store());
    expect(result).toMatchObject({ accepted: true, summary: { new: 7, changed: 0, equal: 0 } });
    expect(result.items.filter(({ kind }) => kind === "tag" || kind === "checklistItem").map(({ label }) => label)).toEqual([
      "TI › Urgente",
      "Acesso a sistema › Conferir backup",
      "Acesso a sistema › Testar acesso",
    ]);
  });

  it("refuses a version mismatch and an invalid item, with the path", async () => {
    const mismatch = await previewConfigurationImport(JSON.stringify(fileOf(1, data())), store());
    expect(mismatch).toMatchObject({ accepted: false });
    expect(mismatch.problems.map(({ path }) => path)).toEqual(["data › sectors › 0 › tags", "data › services › 0 › checklist"]);

    const invalid = data();
    invalid.sectors[0].tags = [tag({ color: "pink" })];
    const result = await previewConfigurationImport(JSON.stringify(fileOf(2, invalid)), store());
    expect(result).toMatchObject({ accepted: false, items: [] });
    expect(result.problems.map(({ path }) => path)).toEqual(["sectors › TI › tags › Urgente › color"]);
  });
});
