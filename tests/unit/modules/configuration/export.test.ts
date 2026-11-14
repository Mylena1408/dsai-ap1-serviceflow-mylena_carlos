import { describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "@/server/errors";

const authorization = vi.hoisted(() => ({ actor: null as unknown }));
vi.mock("@/server/authorization", () => ({
  requireConfigurationAdministrator: vi.fn(async () => {
    const actor = authorization.actor as { role: string } | null;
    if (!actor || actor.role !== "ADMIN") throw new AuthorizationError();
    return actor;
  }),
}));

import {
  CONFIGURATION_FORMAT,
  buildConfigurationData,
  buildConfigurationFile,
  configurationFileName,
  configurationFileSchema,
  repeatedKeys,
  type ConfigurationSnapshot,
} from "@/modules/configuration";
import { exportConfiguration, type ConfigurationExportStore } from "@/modules/configuration/application/export-configuration";

// SPEC 2026-11-07-operacao-e-automacao, 6.3 items 1 to 3 (SF-187; CA-CFG-01 for the export and CA-CFG-02).

const ids = {
  ti: "11111111-1111-4111-8111-111111111111",
  rh: "22222222-2222-4222-8222-222222222222",
  cat: "33333333-3333-4333-8333-333333333333",
  access: "44444444-4444-4444-8444-444444444444",
  desk: "55555555-5555-4555-8555-555555555555",
  system: "66666666-6666-4666-8666-666666666666",
  diego: "77777777-7777-4777-8777-777777777777",
  gone: "88888888-8888-4888-8888-888888888888",
};

const field = (overrides: Partial<ConfigurationSnapshot["fields"][number]> = {}): ConfigurationSnapshot["fields"][number] => ({
  id: ids.system,
  serviceId: ids.access,
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
  conditionFieldId: null,
  conditionValue: null,
  ...overrides,
});

const snapshot = (): ConfigurationSnapshot => ({
  sectors: [
    { id: ids.ti, name: "TI", isActive: true, escalateOverdue: true, distributionMode: "ROUND_ROBIN", maxActivePerAttendant: 5, redistributeOnAbsence: true },
    { id: ids.rh, name: "Atendimento RH", isActive: false, escalateOverdue: false, distributionMode: "NONE", maxActivePerAttendant: null, redistributeOnAbsence: false },
  ],
  escalationRules: [
    {
      sectorId: ids.ti,
      name: "Atraso",
      trigger: "OVERDUE_DAYS",
      overdueDays: 2,
      raisePriority: true,
      assignToId: ids.diego,
      notifyManagers: true,
      notifyTeam: false,
      notifyUserIds: [ids.diego, ids.gone],
      isActive: true,
    },
  ],
  cannedResponses: [{ sectorId: ids.ti, title: "Senha", body: "Use o portal.", isActive: true }],
  categories: [{ id: ids.cat, name: "Acesso", isActive: true }],
  services: [
    {
      id: ids.desk,
      name: "Mesa",
      description: "Troca de mesa",
      categoryId: ids.cat,
      sectorId: ids.rh,
      isActive: true,
      defaultPriority: "LOW",
      slaHours: null,
      slaBusinessHours: false,
      requiresApproval: false,
      approvalSectorIds: [],
      approvalConditionFieldId: null,
      approvalConditionValue: null,
      approvalDeadlineDays: null,
    },
    {
      id: ids.access,
      name: "Acesso a sistema",
      description: "Libera o acesso",
      categoryId: ids.cat,
      sectorId: ids.ti,
      isActive: true,
      defaultPriority: "HIGH",
      slaHours: 8,
      slaBusinessHours: true,
      requiresApproval: true,
      approvalSectorIds: [ids.rh, ids.gone],
      approvalConditionFieldId: ids.system,
      approvalConditionValue: "ERP",
      approvalDeadlineDays: 3,
    },
  ],
  fields: [
    field({ id: "99999999-9999-4999-8999-999999999999", label: "Módulo", type: "SHORT_TEXT", options: [], position: 2, conditionFieldId: ids.system, conditionValue: "ERP" }),
    field(),
  ],
  documents: [{ serviceId: ids.access, name: "Termo", isRequired: true, acceptedFormats: ["TXT", "PDF"], position: 1, isActive: true }],
  stages: [
    { serviceId: ids.access, name: "Liberação", position: 1, isActive: true, assigneeId: ids.diego, targetDays: 2, conditionFieldId: null, conditionValue: null },
  ],
  articles: [{ serviceId: ids.access, title: "Como pedir", body: "Informe o sistema.", isPublished: true, position: 1 }],
  checklistItems: [],
  tags: [],
  accessRoles: [{ name: "Supervisão", description: null, permissions: ["QUEUE_SUPERVISION", "SECTOR_REQUESTS_READ"], isActive: true }],
  calendar: { weekdays: [5, 1, 2, 3, 4], startMinute: 480, endMinute: 1080, timeZone: "America/Sao_Paulo" },
  holidays: [
    { day: "2026-12-25", name: "Natal", yearly: true },
    { day: "2026-11-15", name: "República", yearly: true },
  ],
  bundles: [{ name: "Admissão", description: null, serviceIds: [ids.desk, ids.access, ids.gone], isActive: true }],
  emails: { [ids.diego]: "diego.rocha@exemplo.test" },
});

describe("the exported data (6.3 item 2; CA-CFG-02)", () => {
  it("refers to items by name and label and to people by e-mail, in a fixed order", () => {
    const data = buildConfigurationData(snapshot());

    expect(data.sectors.map(({ name }) => name)).toEqual(["Atendimento RH", "TI"]);
    expect(data.sectors[1]).toMatchObject({
      distributionMode: "ROUND_ROBIN",
      maxActivePerAttendant: 5,
      escalationRules: [{ name: "Atraso", assignTo: "diego.rocha@exemplo.test", notify: ["diego.rocha@exemplo.test"] }],
      cannedResponses: [{ title: "Senha", body: "Use o portal.", isActive: true }],
    });
    expect(data.services.map(({ name }) => name)).toEqual(["Acesso a sistema", "Mesa"]);
    const [access] = data.services;
    expect(access).toMatchObject({
      category: "Acesso",
      sector: "TI",
      // A sector that no longer exists is left out.
      approvalSectors: ["Atendimento RH"],
      approvalCondition: { field: "Sistema", value: "ERP" },
      approvalDeadlineDays: 3,
    });
    expect(access.fields.map(({ label, condition }) => [label, condition])).toEqual([
      ["Sistema", null],
      ["Módulo", { field: "Sistema", value: "ERP" }],
    ]);
    expect(access.documents).toEqual([{ name: "Termo", isRequired: true, acceptedFormats: ["PDF", "TXT"], position: 1, isActive: true }]);
    expect(access.stages).toEqual([{ name: "Liberação", position: 1, isActive: true, assignee: "diego.rocha@exemplo.test", targetDays: 2, condition: null }]);
    expect(access.articles).toEqual([{ title: "Como pedir", body: "Informe o sistema.", isPublished: true, position: 1 }]);
    expect(data.accessRoles).toEqual([{ name: "Supervisão", description: null, permissions: ["QUEUE_SUPERVISION", "SECTOR_REQUESTS_READ"], isActive: true }]);
    expect(data.calendar).toEqual({ weekdays: [1, 2, 3, 4, 5], startTime: "08:00", endTime: "18:00", timeZone: "America/Sao_Paulo" });
    expect(data.holidays.map(({ day }) => day)).toEqual(["2026-11-15", "2026-12-25"]);
    // The bundle keeps its opening order.
    expect(data.bundles).toEqual([{ name: "Admissão", description: null, services: ["Mesa", "Acesso a sistema"], isActive: true }]);
  });

  it("carries no internal identifier and follows the format (6.3 item 3)", () => {
    const file = buildConfigurationFile(snapshot(), new Date("2026-11-07T15:00:00.000Z"));
    const text = JSON.stringify(file);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(file).toMatchObject({ format: CONFIGURATION_FORMAT, version: 2, exportedAt: "2026-11-07T15:00:00.000Z" });
    expect(configurationFileSchema.parse(file)).toEqual(file);
    expect(configurationFileName(new Date("2026-11-07T15:00:00.000Z"))).toBe("serviceflow-configuracao-2026-11-07.json");
  });

  it("the format refuses another format, version or shape", () => {
    const file = buildConfigurationFile(snapshot(), new Date("2026-11-07T15:00:00.000Z"));
    expect(configurationFileSchema.safeParse({ ...file, format: "outro" }).success).toBe(false);
    expect(configurationFileSchema.safeParse({ ...file, version: 3 }).success).toBe(false);
    expect(configurationFileSchema.safeParse({ ...file, data: { ...file.data, users: [] } }).success).toBe(false);
    expect(configurationFileSchema.safeParse({ ...file, data: { ...file.data, sectors: [{ name: "TI" }] } }).success).toBe(false);
  });

  it("finds names repeated in the same scope, ignoring case", () => {
    const data = buildConfigurationData(snapshot());
    expect(repeatedKeys(data)).toEqual([]);
    data.services.push({ ...data.services[1], name: "MESA" });
    data.services[0].fields.push({ ...data.services[0].fields[0], isActive: false });
    expect(repeatedKeys(data)).toEqual(["serviços: MESA", "Acesso a sistema › campos: Sistema"]);
  });
});

describe("exporting (6.3 item 1; CA-CFG-01)", () => {
  const store = (overrides: Partial<ConfigurationExportStore> = {}): ConfigurationExportStore => ({
    snapshot: vi.fn(async () => snapshot()),
    now: vi.fn(async () => new Date("2026-11-07T15:00:00.000Z")),
    recordExport: vi.fn(async () => {}),
    ...overrides,
  });

  it("only the administrator exports, and the export is recorded", async () => {
    for (const role of ["MANAGER", "ATTENDANT", "REQUESTER"]) {
      authorization.actor = { id: "x", role, isActive: true, sectorId: null };
      const refused = store();
      await expect(exportConfiguration(refused)).rejects.toBeInstanceOf(AuthorizationError);
      expect(refused.recordExport).not.toHaveBeenCalled();
    }

    authorization.actor = { id: "adm", role: "ADMIN", isActive: true, sectorId: null };
    const allowed = store();
    const result = await exportConfiguration(allowed);
    expect(allowed.recordExport).toHaveBeenCalledWith(authorization.actor, new Date("2026-11-07T15:00:00.000Z"));
    expect(result).toMatchObject({ fileName: "serviceflow-configuracao-2026-11-07.json", repeated: [], tooLarge: false });
    expect(JSON.parse(result.content)).toMatchObject({ format: "serviceflow-config", version: 2 });
    expect(result.bytes).toBe(new TextEncoder().encode(result.content).length);
  });

  it("reports repeated names and a file over 2 MB", async () => {
    authorization.actor = { id: "adm", role: "ADMIN", isActive: true, sectorId: null };
    const big = snapshot();
    big.services.push({ ...big.services[0], id: ids.gone, name: "mesa" });
    big.articles.push({ serviceId: ids.access, title: "Longo", body: "x".repeat(2_100_000), isPublished: false, position: 2 });
    const result = await exportConfiguration(store({ snapshot: vi.fn(async () => big) }));
    expect(result.repeated).toEqual(["serviços: mesa"]);
    expect(result.tooLarge).toBe(true);
  });
});
