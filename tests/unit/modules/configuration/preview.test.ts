import { describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "@/server/errors";

const authorization = vi.hoisted(() => ({ actor: { id: "adm", role: "ADMIN", isActive: true, sectorId: null } as { role: string } }));
vi.mock("@/server/authorization", () => ({
  requireConfigurationAdministrator: vi.fn(async () => {
    if (authorization.actor.role !== "ADMIN") throw new AuthorizationError();
    return authorization.actor;
  }),
}));

import type { ConfigurationData } from "@/modules/configuration";
import { classifyItems, keyProblems, withoutUnfitPeople, type DestinationPerson } from "@/modules/configuration/domain/preview";
import { validateConfiguration, type DestinationFacts } from "@/modules/configuration/domain/validation";
import { previewConfigurationImport, type ConfigurationImportStore } from "@/modules/configuration/application/preview-import";
import type { ConfigurationSnapshot } from "@/modules/configuration";

// SPEC 2026-11-07-operacao-e-automacao, 6.3 item 4 (SF-188; CA-CFG-03 by the rules).

type Service = ConfigurationData["services"][number];
type Field = Service["fields"][number];

const field = (overrides: Partial<Field> = {}): Field => ({
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
  fields: [field()],
  documents: [],
  stages: [{ name: "Liberação", position: 1, isActive: true, assignee: "diego@exemplo.test", targetDays: 2, condition: null }],
  articles: [],
  ...overrides,
});

const data = (): ConfigurationData => ({
  sectors: [
    {
      name: "TI",
      isActive: true,
      escalateOverdue: false,
      distributionMode: "NONE",
      maxActivePerAttendant: null,
      redistributeOnAbsence: false,
      escalationRules: [
        { name: "Atraso", trigger: "OVERDUE_DAYS", overdueDays: 2, raisePriority: true, assignTo: "diego@exemplo.test", notifyManagers: false, notifyTeam: false, notify: [], isActive: true },
      ],
      cannedResponses: [{ title: "Senha", body: "Use o portal.", isActive: true }],
    },
  ],
  categories: [{ name: "Acesso", isActive: true }],
  services: [service()],
  accessRoles: [{ name: "Supervisão", description: null, permissions: ["QUEUE_SUPERVISION"], isActive: true }],
  calendar: { weekdays: [1, 2, 3, 4, 5], startTime: "08:00", endTime: "18:00", timeZone: "America/Sao_Paulo" },
  holidays: [{ day: "2026-12-25", name: "Natal", yearly: true }],
  bundles: [],
});

const facts: DestinationFacts = { sectorsWithPendingRequests: [], sectorsWithActiveAttendants: [] };
const diego: DestinationPerson = { id: "diego", email: "diego@exemplo.test", role: "ATTENDANT", isActive: true, sectorName: "TI" };
const people = (...list: DestinationPerson[]) => new Map(list.map((person) => [person.email, person]));
const empty = (): ConfigurationData => ({ sectors: [], categories: [], services: [], accessRoles: [], calendar: null, holidays: [], bundles: [] });

describe("classifying the items (6.3 item 4)", () => {
  it("each item is new, changed with its fields, or equal; nested items stand on their own", () => {
    const destination = data();
    const file = data();
    file.services[0] = service({ description: "Outra", fields: [field({ isRequired: false }), field({ label: "Módulo", type: "SHORT_TEXT", options: [], position: 2 })] });
    file.categories.push({ name: "RH", isActive: true });

    const items = classifyItems(file, destination);
    expect(items.find((item) => item.kind === "service")).toEqual({ kind: "service", label: "Acesso a sistema", status: "changed", changes: ["description"] });
    expect(items.filter((item) => item.kind === "field")).toEqual([
      { kind: "field", label: "Acesso a sistema › Sistema", status: "changed", changes: ["isRequired"] },
      { kind: "field", label: "Acesso a sistema › Módulo", status: "new", changes: [] },
    ]);
    expect(items.find((item) => item.label === "RH")).toMatchObject({ status: "new" });
    expect(items.find((item) => item.kind === "sector")).toMatchObject({ status: "equal", changes: [] });
    expect(classifyItems(data(), data()).every((item) => item.status === "equal")).toBe(true);
  });

  it("matches names ignoring case; a calendar left out of the file is not an item", () => {
    const file = data();
    file.categories[0].name = "ACESSO";
    file.calendar = null;
    const items = classifyItems(file, data());
    expect(items.find((item) => item.kind === "category")).toMatchObject({ status: "changed", changes: ["name"] });
    expect(items.some((item) => item.kind === "calendar")).toBe(false);
  });
});

describe("people by e-mail (6.3 item 4)", () => {
  it("people who do not exist or cannot take the role stay out, with a warning", () => {
    const file = data();
    file.sectors[0].escalationRules[0].notify = ["gestor@exemplo.test", "fora@exemplo.test"];
    const manager: DestinationPerson = { id: "gestor", email: "gestor@exemplo.test", role: "MANAGER", isActive: true, sectorName: "TI" };
    const elsewhere: DestinationPerson = { ...diego, sectorName: "RH" };

    const result = withoutUnfitPeople(file, empty(), people(elsewhere, manager));
    expect(result.data.sectors[0].escalationRules[0]).toMatchObject({ assignTo: null, notify: ["gestor@exemplo.test"] });
    expect(result.data.services[0].stages[0].assignee).toBeNull();
    expect(result.warnings.map(({ path }) => path)).toEqual([
      "sectors › TI › escalationRules › Atraso › assignTo",
      "sectors › TI › escalationRules › Atraso › notify",
      "services › Acesso a sistema › stages › Liberação › assignee",
    ]);
    expect(result.warnings[0].message).toContain("diego@exemplo.test");
  });

  it("the person the destination already has there stays, even if they could not be chosen now", () => {
    const result = withoutUnfitPeople(data(), data(), people());
    expect(result.warnings).toEqual([]);
    expect(result.data).toEqual(data());
    expect(withoutUnfitPeople(data(), empty(), people(diego)).warnings).toEqual([]);
  });
});

describe("repeated names (clarification of SF-187)", () => {
  it("a name repeated in the file, or repeated in the destination and used by the file, refuses the file", () => {
    const file = data();
    file.categories.push({ name: "acesso", isActive: false });
    expect(keyProblems(file, []).map(({ path }) => path)).toEqual(["categorias: acesso"]);
    expect(keyProblems(data(), ["serviços: ACESSO A SISTEMA", "serviços: Outro"]).map(({ path }) => path)).toEqual(["serviços: ACESSO A SISTEMA"]);
  });
});

describe("the screens' rules (6.3 item 4)", () => {
  const paths = (file: ConfigurationData, destination: ConfigurationData = empty(), destinationFacts = facts) =>
    validateConfiguration(file, destination, destinationFacts).map(({ path }) => path);

  it("accepts a valid configuration, and anything equal to the destination", () => {
    expect(paths(data())).toEqual([]);
    expect(paths(data(), data())).toEqual([]);
  });

  it("refuses values out of each screen's rules, naming where", () => {
    const file = data();
    file.sectors[0].maxActivePerAttendant = 0;
    file.sectors[0].escalationRules[0] = { ...file.sectors[0].escalationRules[0], trigger: "DUE_SOON" };
    file.sectors[0].cannedResponses[0].body = " ";
    file.categories[0].name = " ";
    file.services[0] = service({ category: "Inexistente", slaHours: 0, fields: [field({ options: ["Só uma"] })] });
    file.accessRoles[0].permissions = [];
    file.calendar = { ...file.calendar!, startTime: "18:00", endTime: "08:00" };
    file.holidays[0].day = "25/12/2026";

    expect(paths(file)).toEqual([
      "sectors › TI › maxActivePerAttendant",
      "sectors › TI › escalationRules › Atraso › overdueDays",
      "sectors › TI › cannedResponses › Senha › body",
      "categories ›   › name",
      "services › Acesso a sistema › slaHours",
      "services › Acesso a sistema › category",
      "services › Acesso a sistema › fields › Sistema › options",
      "accessRoles › Supervisão › permissions",
      "calendar › endTime",
      "holidays › 25/12/2026 › day",
    ]);
  });

  it("checks references, conditions and the limits of each group", () => {
    const file = data();
    file.services[0] = service({
      sector: "Inexistente",
      approvalSectors: ["TI", "TI"],
      approvalCondition: { field: "Sistema", value: "SAP" },
      fields: [
        field(),
        field({ label: "Módulo", type: "SHORT_TEXT", options: [], position: 2, condition: { field: "Sistema", value: "Outro" } }),
        ...Array.from({ length: 10 }, (_, index) => field({ label: `Extra ${index}`, type: "SHORT_TEXT", options: [], position: 3 + index })),
      ],
    });
    expect(paths(file)).toEqual([
      "services › Acesso a sistema › sector",
      "services › Acesso a sistema › approvalSectors",
      "services › Acesso a sistema › approvalCondition",
      "services › Acesso a sistema › fields › Módulo › condition",
      "services › Acesso a sistema › fields",
      "services › Acesso a sistema › fields › Sistema",
    ]);
  });

  it("refuses changes the screens do not allow", () => {
    const destination = data();
    const file = data();
    file.services[0] = service({ fields: [field({ type: "MULTI_SELECT" })] });
    file.sectors[0].isActive = false;
    file.categories[0].isActive = false;
    expect(paths(file, destination, { sectorsWithPendingRequests: [], sectorsWithActiveAttendants: ["TI"] })).toEqual([
      "sectors › TI › isActive",
      "categories › Acesso › isActive",
      // The service itself is equal to the destination: its category's deactivation is what is refused.
      "services › Acesso a sistema › fields › Sistema › type",
    ]);

    // A controller of an active field keeps the option its condition uses.
    const conditioned = data();
    conditioned.services[0].fields.push(field({ label: "Módulo", type: "SHORT_TEXT", options: [], position: 2, condition: { field: "Sistema", value: "ERP" } }));
    const withoutOption = structuredClone(conditioned);
    withoutOption.services[0].fields[0].options = ["CRM", "SAP"];
    expect(paths(withoutOption, conditioned)).toEqual(["services › Acesso a sistema › fields › Sistema"]);
  });

  it("an active bundle needs services that may be in a bundle after the import", () => {
    const file = data();
    file.services.push(service({ name: "Mesa", stages: [], documents: [{ name: "Termo", isRequired: true, acceptedFormats: ["PDF"], position: 1, isActive: true }] }));
    file.bundles.push({ name: "Admissão", description: null, services: ["Acesso a sistema", "Mesa", "Sumido"], isActive: true });
    expect(paths(file)).toEqual(["bundles › Admissão › services › Mesa", "bundles › Admissão › services › Sumido"]);
  });
});

describe("the preview (6.3 item 4; CA-CFG-03)", () => {
  const snapshot: ConfigurationSnapshot = {
    sectors: [],
    escalationRules: [],
    cannedResponses: [],
    categories: [],
    services: [],
    fields: [],
    documents: [],
    stages: [],
    articles: [],
    accessRoles: [],
    calendar: null,
    holidays: [],
    bundles: [],
    emails: {},
  };
  const store = (): ConfigurationImportStore => ({
    snapshot: vi.fn(async () => snapshot),
    facts: vi.fn(async () => facts),
    people: vi.fn(async () => [diego]),
  });
  const fileText = (content: ConfigurationData = data()) =>
    JSON.stringify({ format: "serviceflow-config", version: 1, exportedAt: "2026-11-07T15:00:00.000Z", data: content });

  it("only the administrator previews", async () => {
    authorization.actor = { id: "x", role: "MANAGER", isActive: true, sectorId: "s" } as never;
    await expect(previewConfigurationImport(fileText(), store())).rejects.toBeInstanceOf(AuthorizationError);
    authorization.actor = { id: "adm", role: "ADMIN", isActive: true, sectorId: null } as never;
  });

  it("refuses what is not a configuration file, with the reason", async () => {
    for (const [content, path] of [
      ["não é json", "arquivo"],
      [JSON.stringify({ format: "outro", version: 1, exportedAt: "", data: data() }), "format"],
      [fileText().replace('"version":1', '"version":2'), "version"],
      [JSON.stringify({ format: "serviceflow-config", version: 1, exportedAt: "", data: { ...data(), users: [] } }), "data"],
      ["x".repeat(2 * 1024 * 1024 + 1), "arquivo"],
    ] as const) {
      const result = await previewConfigurationImport(content, store());
      expect(result).toMatchObject({ accepted: false, items: [] });
      expect(result.problems[0].path).toBe(path);
    }
  });

  it("lists at most 50 problems and says how many there are", async () => {
    const file = data();
    file.holidays = Array.from({ length: 60 }, (_, index) => ({ day: `dia ${index}`, name: "Feriado", yearly: false }));
    const result = await previewConfigurationImport(fileText(file), store());
    expect(result).toMatchObject({ accepted: false, problemCount: 60 });
    expect(result.problems).toHaveLength(50);
  });

  it("classifies an accepted file, with the digests for the application", async () => {
    const result = await previewConfigurationImport(fileText(), store());
    expect(result).toMatchObject({ accepted: true, problems: [], warnings: [], summary: { new: 10, changed: 0, equal: 0 } });
    expect(result.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.destinationDigest).toMatch(/^[0-9a-f]{64}$/);
    expect((await previewConfigurationImport(fileText(), store())).digest).toBe(result.digest);
  });
});
