import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError, AuthorizationError, ValidationError } from "@/server/errors";
import type {
  CurrentCounts,
  DashboardReader,
  ExportRequestRow,
  PeriodTotals,
  ReportSector,
} from "@/modules/reports/application/ports";

const authorization = vi.hoisted(() => ({ requireCurrentActor: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import { exportDashboardCsv, getDashboard } from "@/modules/reports/application/dashboard";

// SPEC 2026-11-02-painel-relatorios, 5.1, 5.3, 5.4 and 5.7 (SF-098; CA-DASH-02 to 06).

const now = new Date("2026-11-02T15:00:00.000Z");
const HOUR = 60 * 60 * 1000;

const infra: ReportSector = { id: "11111111-1111-4111-8111-111111111111", name: "Infraestrutura", isActive: true };
const people: ReportSector = { id: "22222222-2222-4222-8222-222222222222", name: "Pessoas", isActive: true };
const closed: ReportSector = { id: "33333333-3333-4333-8333-333333333333", name: "Arquivo", isActive: false };

const current: CurrentCounts = { open: 4, awaitingApproval: 1, inProgress: 2, dueSoon: 1, overdue: 1 };
const totals: PeriodTotals = {
  opened: 6,
  completed: 3,
  cancelled: 1,
  completion: { averageMs: 12 * HOUR, medianMs: 4 * HOUR },
  withDueDate: 3,
  onTime: 2,
  byCategory: [
    { label: "Manutenção", count: 2 },
    { label: "Tecnologia", count: 4 },
  ],
  bySector: [
    { label: "Pessoas", count: 1 },
    { label: "Infraestrutura", count: 5 },
  ],
  byStatus: [
    { status: "OPEN", count: 2 },
    { status: "COMPLETED", count: 3 },
    { status: "CANCELLED", count: 1 },
  ],
};

const exportRow: ExportRequestRow = {
  id: "3f2a9c1e-0000-4000-8000-000000000001",
  serviceName: "Reparo elétrico",
  categoryName: "Manutenção",
  sectorName: "Infraestrutura",
  status: "IN_PROGRESS",
  priority: "NORMAL",
  approvalState: null,
  stageName: null,
  assigneeName: "Diego Rocha",
  createdAt: new Date("2026-10-30T12:00:00.000Z"),
  completedAt: null,
  cancelledAt: null,
  dueAt: new Date("2026-11-01T12:00:00.000Z"),
  completedLate: null,
  slaHoursSnapshot: 48,
};

function reader(overrides: Partial<DashboardReader> = {}): DashboardReader {
  return {
    findSector: vi.fn(async (id: string) => [infra, people, closed].find((sector) => sector.id === id) ?? null),
    listSectors: vi.fn(async () => [closed, infra, people]),
    currentCounts: vi.fn(async () => current),
    periodTotals: vi.fn(async () => totals),
    listForExport: vi.fn(async () => [exportRow]),
    ...overrides,
  };
}

function actAs(role: "ADMIN" | "MANAGER" | "ATTENDANT" | "REQUESTER", sectorId: string | null = null) {
  authorization.requireCurrentActor.mockResolvedValue({ id: `${role}-id`, role, sectorId, isActive: true });
}

describe("dashboard of the administrator (CA-DASH-02)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the whole organization by default and shows the sector groups", async () => {
    actAs("ADMIN");
    const port = reader();

    const dashboard = await getDashboard({}, port, now);

    expect(port.currentCounts).toHaveBeenCalledWith({ sectorId: null }, now);
    expect(port.periodTotals).toHaveBeenCalledWith(
      { sectorId: null },
      { from: dashboard.period.from, before: dashboard.period.before },
    );
    expect(dashboard).toMatchObject({
      audience: "organization",
      sectors: [closed, infra, people],
      sector: null,
      withoutSector: false,
      errors: { period: null, sector: null },
      current,
      empty: false,
    });
    expect(dashboard.period.option).toBe("30");
    expect(dashboard.totals.bySector).toEqual([
      { label: "Infraestrutura", count: 5 },
      { label: "Pessoas", count: 1 },
    ]);
  });

  it("filters by one sector, inactive ones included, and then hides the sector groups", async () => {
    actAs("ADMIN");
    const port = reader();

    const dashboard = await getDashboard({ sector: closed.id }, port, now);

    expect(port.currentCounts).toHaveBeenCalledWith({ sectorId: closed.id }, now);
    expect(dashboard.sector).toEqual({ id: closed.id, name: "Arquivo" });
    expect(dashboard.totals.bySector).toBeNull();
  });

  it("refuses an unknown sector, reports it and shows the whole organization", async () => {
    actAs("ADMIN");
    const port = reader();

    for (const sector of ["44444444-4444-4444-8444-444444444444", "not-a-uuid"]) {
      const dashboard = await getDashboard({ sector }, port, now);
      expect(dashboard.errors.sector).toBe("invalid_sector");
      expect(dashboard.sector).toBeNull();
      expect(port.currentCounts).toHaveBeenLastCalledWith({ sectorId: null }, now);
    }
  });
});

describe("dashboard of the manager (CA-DASH-02)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads only the manager's current sector and ignores a sector in the URL", async () => {
    actAs("MANAGER", people.id);
    const port = reader();

    const dashboard = await getDashboard({ sector: infra.id }, port, now);

    expect(port.listSectors).not.toHaveBeenCalled();
    expect(port.currentCounts).toHaveBeenCalledWith({ sectorId: people.id }, now);
    expect(port.periodTotals).toHaveBeenCalledWith({ sectorId: people.id }, expect.anything());
    expect(dashboard).toMatchObject({
      audience: "sector",
      sectors: [],
      sector: { id: people.id, name: "Pessoas" },
      withoutSector: false,
      errors: { sector: null },
    });
    expect(dashboard.totals.bySector).toBeNull();
  });

  it.each([
    ["without a sector", null],
    ["with an inactive sector", closed.id],
  ])("shows an empty dashboard to a manager %s, without reading any request", async (_, sectorId) => {
    actAs("MANAGER", sectorId);
    const port = reader();

    const dashboard = await getDashboard({}, port, now);

    expect(port.currentCounts).not.toHaveBeenCalled();
    expect(port.periodTotals).not.toHaveBeenCalled();
    expect(dashboard).toMatchObject({
      withoutSector: true,
      sector: null,
      current: { open: 0, awaitingApproval: 0, inProgress: 0, dueSoon: 0, overdue: 0 },
      empty: true,
    });
    expect(dashboard.totals).toMatchObject({ opened: 0, completion: null, onTimePercentage: null, byCategory: [] });
  });
});

describe("who is refused (CA-DASH-02)", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["ATTENDANT", "REQUESTER"] as const)("refuses the %s before reading anything", async (role) => {
    actAs(role, infra.id);
    const port = reader();

    await expect(getDashboard({}, port, now)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(exportDashboardCsv({}, port, now)).rejects.toBeInstanceOf(AuthorizationError);
    for (const method of Object.values(port)) {
      expect(method).not.toHaveBeenCalled();
    }
  });

  it("refuses without a session", async () => {
    authorization.requireCurrentActor.mockRejectedValue(new AuthenticationError());
    await expect(getDashboard({}, reader(), now)).rejects.toBeInstanceOf(AuthenticationError);
  });
});

describe("indicators (CA-DASH-03 to 06)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("formats times, percentage and groups from the reader's totals", async () => {
    actAs("ADMIN");

    const dashboard = await getDashboard({ period: "7" }, reader(), now);

    expect(dashboard.period).toMatchObject({ option: "7", firstDay: "2026-10-27", lastDay: "2026-11-02" });
    expect(dashboard.totals).toEqual({
      opened: 6,
      completed: 3,
      cancelled: 1,
      completion: { averageHours: 12, medianHours: 4 },
      onTimePercentage: 67,
      byCategory: [
        { label: "Tecnologia", count: 4 },
        { label: "Manutenção", count: 2 },
      ],
      bySector: [
        { label: "Infraestrutura", count: 5 },
        { label: "Pessoas", count: 1 },
      ],
      byStatus: [
        { label: "Concluída", count: 3 },
        { label: "Aberta", count: 2 },
        { label: "Cancelada", count: 1 },
      ],
    });
  });

  it("shows nothing for times and percentage without completed requests or due dates (CA-DASH-05)", async () => {
    actAs("ADMIN");
    const port = reader({
      periodTotals: vi.fn(async () => ({ ...totals, completion: null, withDueDate: 0, onTime: 0 })),
    });

    const dashboard = await getDashboard({}, port, now);

    expect(dashboard.totals.completion).toBeNull();
    expect(dashboard.totals.onTimePercentage).toBeNull();
  });

  it("is empty when nothing was opened, completed or cancelled in the period", async () => {
    actAs("ADMIN");
    const port = reader({
      periodTotals: vi.fn(async () => ({ ...totals, opened: 0, completed: 0, cancelled: 0, completion: null, byCategory: [], bySector: [], byStatus: [] })),
    });

    expect((await getDashboard({}, port, now)).empty).toBe(true);
  });

  it("reports a refused period and shows the last 30 days (CA-DASH-07)", async () => {
    actAs("ADMIN");
    const port = reader();

    const dashboard = await getDashboard({ period: "custom", from: "2026-10-31", to: "2026-10-01" }, port, now);

    expect(dashboard.errors.period).toBe("inverted_range");
    expect(dashboard.period.option).toBe("30");
  });
});

describe("CSV export (CA-DASH-08)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("exports the requests opened in the period of the same scope, with the situation computed now", async () => {
    actAs("MANAGER", infra.id);
    const port = reader();

    const csv = await exportDashboardCsv({ period: "custom", from: "2026-10-01", to: "2026-10-31" }, port, now);

    expect(port.listForExport).toHaveBeenCalledWith(
      { sectorId: infra.id },
      { from: new Date("2026-10-01T03:00:00.000Z"), before: new Date("2026-11-01T03:00:00.000Z") },
      10_001,
    );
    expect(csv.fileName).toBe("serviceflow-solicitacoes-2026-10-01-a-2026-10-31.csv");
    expect(csv.content.split("\r\n")[1]).toBe(
      "3F2A9C1E;Reparo elétrico;Manutenção;Infraestrutura;Em atendimento;Normal;;;Diego Rocha;2026-10-30 09:00;;;2026-11-01 09:00;Vencido;",
    );
  });

  it("gives a manager without an active sector only the header", async () => {
    actAs("MANAGER", closed.id);
    const port = reader();

    const csv = await exportDashboardCsv({}, port, now);

    expect(port.listForExport).not.toHaveBeenCalled();
    expect(csv.content.split("\r\n")).toHaveLength(2);
  });

  it("refuses a refused period or sector instead of exporting the default", async () => {
    actAs("ADMIN");
    const port = reader();

    await expect(exportDashboardCsv({ period: "custom" }, port, now)).rejects.toBeInstanceOf(ValidationError);
    await expect(exportDashboardCsv({ sector: "unknown" }, port, now)).rejects.toBeInstanceOf(ValidationError);
    expect(port.listForExport).not.toHaveBeenCalled();
  });

  it("refuses more than 10,000 requests", async () => {
    actAs("ADMIN");
    const port = reader({ listForExport: vi.fn(async () => Array.from({ length: 10_001 }, () => exportRow)) });

    await expect(exportDashboardCsv({}, port, now)).rejects.toBeInstanceOf(ValidationError);
  });
});
