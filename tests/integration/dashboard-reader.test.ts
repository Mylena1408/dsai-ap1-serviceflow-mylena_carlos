import { describe, expect, it, vi } from "vitest";
import type { Prisma, Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";
import { createPrismaDashboardReader } from "@/modules/reports/infrastructure/prisma-dashboard-reader";
import { AuthorizationError } from "@/server/errors";

// SPEC 2026-11-02-painel-relatorios, 5.1, 5.3, 5.4 and 5.6 (SF-098; CA-DASH-02 to 06).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { exportDashboardCsv, getDashboard } from "@/modules/reports";

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-11-02T15:00:00.000Z");
// October in São Paulo: from 2026-10-01 00:00 (03:00 UTC) to 2026-11-01 00:00 (03:00 UTC).
const october = { from: new Date("2026-10-01T03:00:00.000Z"), before: new Date("2026-11-01T03:00:00.000Z") };
const at = (iso: string) => new Date(iso);

type RequestData = Partial<Prisma.RequestUncheckedCreateInput> & { createdAt: Date };

/**
 * Sector A ("Infraestrutura") and sector B ("Pessoas"), with requests around October:
 * r1–r3 completed in October (2 h, 4 h and 30 h; two with a due date, one on time), r8 opened in
 * September and completed in October (48 h), r4 cancelled, r5 opened at 23:59 of October 31 in
 * São Paulo (still October) and waiting for approval, r6 opened at midnight of November 1 (not
 * October) and due soon, r7 overdue, r9 open in sector B.
 */
async function scenario() {
  const sectorA = await createDomainSector();
  const sectorB = await createDomainSector();
  const category = await createDomainCategory();
  const serviceA = await createDomainService({ categoryId: category.id, sectorId: sectorA.id });
  const serviceB = await createDomainService({ categoryId: category.id, sectorId: sectorB.id });
  const requester = await createDomainUser({ role: "REQUESTER" });
  const diego = await prisma.user.create({
    data: { name: "Diego Rocha", email: `diego-${Date.now()}@example.test`, role: "ATTENDANT", sectorId: sectorA.id, passwordHash: "$argon2id$integration-placeholder" },
  });

  async function request(sector: "A" | "B", categoryName: string, data: RequestData) {
    const [sectorRow, service] = sector === "A" ? [sectorA, serviceA] : [sectorB, serviceB];
    return prisma.request.create({
      data: {
        requesterId: requester.id,
        serviceId: service.id,
        sectorId: sectorRow.id,
        serviceNameSnapshot: "Reparo elétrico",
        serviceDescriptionSnapshot: "Descrição do serviço",
        categoryIdSnapshot: category.id,
        categoryNameSnapshot: categoryName,
        sectorNameSnapshot: sector === "A" ? "Infraestrutura" : "Pessoas",
        description: "Texto confidencial da solicitação",
        ...data,
      },
    });
  }

  const r1 = await request("A", "Manutenção", {
    createdAt: at("2026-10-10T12:00:00.000Z"),
    status: "COMPLETED",
    completedAt: at("2026-10-10T14:00:00.000Z"),
    slaHoursSnapshot: 4,
    dueAt: at("2026-10-10T16:00:00.000Z"),
    completedLate: false,
    assigneeId: diego.id,
    stageNamesSnapshot: ["Triagem", "Execução"],
    stageIndex: 1,
    priority: "HIGH",
  });
  await request("A", "Manutenção", {
    createdAt: at("2026-10-11T00:00:00.000Z"),
    status: "COMPLETED",
    completedAt: at("2026-10-11T04:00:00.000Z"),
    slaHoursSnapshot: 2,
    dueAt: at("2026-10-11T02:00:00.000Z"),
    completedLate: true,
  });
  await request("A", "Tecnologia", {
    createdAt: at("2026-10-12T00:00:00.000Z"),
    status: "COMPLETED",
    completedAt: at("2026-10-13T06:00:00.000Z"),
  });
  await request("A", "Tecnologia", {
    createdAt: at("2026-10-20T12:00:00.000Z"),
    status: "CANCELLED",
    cancelledAt: at("2026-10-21T12:00:00.000Z"),
  });
  const r5 = await request("A", "Tecnologia", {
    createdAt: at("2026-11-01T02:59:00.000Z"),
    status: "OPEN",
    approvalState: "PENDING",
  });
  await request("A", "Tecnologia", {
    createdAt: at("2026-11-01T03:00:00.000Z"),
    status: "IN_PROGRESS",
    slaHoursSnapshot: 10,
    dueAt: new Date(now.getTime() + HOUR),
  });
  await request("A", "Manutenção", {
    createdAt: at("2026-09-30T12:00:00.000Z"),
    status: "OPEN",
    slaHoursSnapshot: 1,
    dueAt: new Date(now.getTime() - HOUR),
  });
  await request("A", "Manutenção", {
    createdAt: at("2026-09-30T12:00:00.000Z"),
    status: "COMPLETED",
    completedAt: at("2026-10-02T12:00:00.000Z"),
  });
  await request("B", "Manutenção", { createdAt: at("2026-10-15T12:00:00.000Z"), status: "OPEN" });

  return { sectorA, sectorB, r1, r5 };
}

function actAs(role: Role, sectorId: string | null = null) {
  session.getCurrentUser.mockResolvedValue({
    id: `${role.toLowerCase()}-actor`,
    name: role,
    email: `${role.toLowerCase()}@example.test`,
    role,
    sectorId,
    isActive: true,
  });
}

describe("Prisma dashboard reader (SF-098)", () => {
  it("counts the current situation of every request or of one sector (CA-DASH-03)", async () => {
    const { sectorA, sectorB } = await scenario();
    const reader = createPrismaDashboardReader(prisma);

    await expect(reader.currentCounts({ sectorId: null }, now)).resolves.toEqual({
      open: 3,
      awaitingApproval: 1,
      inProgress: 1,
      dueSoon: 1,
      overdue: 1,
      // Added by SPEC 2026-11-03-pausa-sla-calendario, 5.7.
      paused: 0,
    });
    await expect(reader.currentCounts({ sectorId: sectorA.id }, now)).resolves.toMatchObject({ open: 2, inProgress: 1 });
    await expect(reader.currentCounts({ sectorId: sectorB.id }, now)).resolves.toEqual({
      open: 1,
      awaitingApproval: 0,
      inProgress: 0,
      dueSoon: 0,
      overdue: 0,
      paused: 0,
    });
  });

  it("counts the period by opening, completion and cancellation in São Paulo days (CA-DASH-04 to 06)", async () => {
    await scenario();
    const totals = await createPrismaDashboardReader(prisma).periodTotals({ sectorId: null }, october);

    expect(totals).toMatchObject({
      opened: 6,
      completed: 4,
      cancelled: 1,
      completion: { averageMs: 21 * HOUR, medianMs: 17 * HOUR },
      withDueDate: 2,
      onTime: 1,
    });
    const byLabel = (groups: Array<{ label: string; count: number }>) =>
      Object.fromEntries(groups.map((group) => [group.label, group.count]));
    expect(byLabel(totals.byCategory)).toEqual({ Manutenção: 3, Tecnologia: 3 });
    expect(byLabel(totals.bySector)).toEqual({ Infraestrutura: 5, Pessoas: 1 });
    expect(Object.fromEntries(totals.byStatus.map((group) => [group.status, group.count]))).toEqual({
      COMPLETED: 3,
      CANCELLED: 1,
      OPEN: 2,
    });
  });

  it("has no completion times when nothing was completed in the period", async () => {
    const { sectorB } = await scenario();
    const totals = await createPrismaDashboardReader(prisma).periodTotals({ sectorId: sectorB.id }, october);

    expect(totals).toMatchObject({ opened: 1, completed: 0, completion: null, withDueDate: 0, onTime: 0 });
  });

  it("lists the requests opened in the period for the export, oldest first, with only the minimal columns", async () => {
    const { sectorA, r1, r5 } = await scenario();
    const reader = createPrismaDashboardReader(prisma);

    const rows = await reader.listForExport({ sectorId: sectorA.id }, october, 10);
    expect(rows.map((row) => row.id)).toHaveLength(5);
    expect(rows[0]).toEqual({
      id: r1.id,
      serviceName: "Reparo elétrico",
      categoryName: "Manutenção",
      sectorName: "Infraestrutura",
      status: "COMPLETED",
      priority: "HIGH",
      approvalState: null,
      stageName: "Execução",
      assigneeName: "Diego Rocha",
      createdAt: at("2026-10-10T12:00:00.000Z"),
      completedAt: at("2026-10-10T14:00:00.000Z"),
      cancelledAt: null,
      dueAt: at("2026-10-10T16:00:00.000Z"),
      completedLate: false,
      slaHoursSnapshot: 4,
    });
    expect(rows.at(-1)).toMatchObject({ id: r5.id, approvalState: "PENDING", stageName: null, assigneeName: null });
    await expect(reader.listForExport({ sectorId: sectorA.id }, october, 2)).resolves.toHaveLength(2);
  });
});

describe("dashboard through the module API (SF-098; CA-DASH-02)", () => {
  it("gives the administrator the organization or one sector, and a manager only the own sector", async () => {
    const { sectorA, sectorB } = await scenario();
    const period = { period: "custom", from: "2026-10-01", to: "2026-10-31" };

    actAs("ADMIN");
    const organization = await getDashboard(period, prisma, now);
    expect(organization.totals).toMatchObject({
      opened: 6,
      completion: { averageHours: 21, medianHours: 17 },
      onTimePercentage: 50,
    });
    expect(organization.totals.bySector).toEqual([
      { label: "Infraestrutura", count: 5 },
      { label: "Pessoas", count: 1 },
    ]);
    expect((await getDashboard({ ...period, sector: sectorB.id }, prisma, now)).totals.opened).toBe(1);

    actAs("MANAGER", sectorB.id);
    const manager = await getDashboard({ ...period, sector: sectorA.id }, prisma, now);
    expect(manager.sector).toEqual({ id: sectorB.id, name: sectorB.name });
    expect(manager.totals.opened).toBe(1);
    expect(manager.current.open).toBe(1);
  });

  it("refuses attendants and requesters", async () => {
    const { sectorA } = await scenario();

    for (const role of ["ATTENDANT", "REQUESTER"] as const) {
      actAs(role, role === "ATTENDANT" ? sectorA.id : null);
      await expect(getDashboard({}, prisma, now)).rejects.toBeInstanceOf(AuthorizationError);
      await expect(exportDashboardCsv({}, prisma, now)).rejects.toBeInstanceOf(AuthorizationError);
    }
  });

  it("exports only the scope of the manager, without the description (CA-DASH-08, 09)", async () => {
    const { sectorA } = await scenario();
    actAs("MANAGER", sectorA.id);

    const csv = await exportDashboardCsv({ period: "custom", from: "2026-10-01", to: "2026-10-31" }, prisma, now);

    const lines = csv.content.split("\r\n");
    expect(lines).toHaveLength(1 + 5 + 1);
    expect(lines[1]).toContain(";Reparo elétrico;Manutenção;Infraestrutura;Concluída;Alta;;Execução;Diego Rocha;2026-10-10 09:00;");
    expect(lines[1].endsWith(";Concluída no prazo;Sim")).toBe(true);
    expect(csv.content).not.toContain("Pessoas");
    expect(csv.content).not.toContain("Texto confidencial");
    expect(csv.content).not.toContain("Descrição do serviço");
  });
});
