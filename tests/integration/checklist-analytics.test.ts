import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-08-atendimento-dia-a-dia, 9.1 item 3 (SF-223; CA-CMP-03 for the checklist): the requests completed in
// the period that have checklist items, how many had every item marked, and the optional items left unmarked.

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { getAnalytics } from "@/modules/reports";

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
const now = new Date("2026-11-15T15:00:00.000Z");
const PERIOD = { period: "custom", from: "2026-11-01", to: "2026-11-14" };
const IN_PERIOD = new Date("2026-11-10T15:00:00.000Z");

async function scenario() {
  const ti = await createDomainSector();
  const rh = await createDomainSector();
  const category = await createDomainCategory();
  const repair = await createDomainService({ categoryId: category.id, sectorId: ti.id });
  const payroll = await createDomainService({ categoryId: category.id, sectorId: rh.id });
  const admin = await createDomainUser({ role: "ADMIN" });
  const gabi = await createDomainUser({ role: "MANAGER", sectorId: ti.id });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: ti.id });
  const rita = await createDomainUser({ role: "REQUESTER" });

  /** A request with its checklist: each item [text, required, marked]. */
  const request = async (
    serviceId: string,
    sectorId: string,
    items: Array<[string, boolean, boolean]>,
    end: { status?: "COMPLETED" | "IN_PROGRESS"; completedAt?: Date } = {},
  ) => {
    const created = await createDomainRequest({ requesterId: rita.id, serviceId, sectorId, status: end.status ?? "COMPLETED" });
    if ((end.status ?? "COMPLETED") === "COMPLETED") {
      await prisma.request.update({ where: { id: created.id }, data: { completedAt: end.completedAt ?? IN_PERIOD } });
    }
    if (items.length > 0) await prisma.requestChecklist.create({ data: { requestId: created.id, copiedAt: IN_PERIOD } });
    let position = 0;
    for (const [text, isRequired, marked] of items) {
      position += 1;
      await prisma.requestChecklistItem.create({
        data: { requestId: created.id, textSnapshot: text, isRequired, position, doneAt: marked ? IN_PERIOD : null, doneById: marked ? ana.id : null },
      });
    }
    return created;
  };

  // TI: three completed in the period with a checklist, one complete.
  await request(repair.id, ti.id, [["Conferir backup", true, true], ["Avisar o usuário", false, true]]);
  await request(repair.id, ti.id, [["Conferir backup", true, true], ["Avisar o usuário", false, false], ["Fotografar", false, false]]);
  await request(repair.id, ti.id, [["Conferir backup", true, true], ["Avisar o usuário", false, false]]);
  // Never counted: without a checklist, outside the period, not completed.
  await request(repair.id, ti.id, []);
  await request(repair.id, ti.id, [["Avisar o usuário", false, false]], { completedAt: new Date("2026-10-20T12:00:00.000Z") });
  await request(repair.id, ti.id, [["Avisar o usuário", false, false]], { status: "IN_PROGRESS" });
  // RH: one completed in the period, complete.
  await request(payroll.id, rh.id, [["Conferir folha", false, true]]);

  return { ti, rh, repair, payroll, admin, gabi };
}

describe("checklist in \"Análises\" (SF-223)", () => {
  it("the manager sees the sector's completed requests with a checklist and the optional items left unmarked", async () => {
    const { ti, repair, gabi } = await scenario();
    actAs({ id: gabi.id, name: gabi.name, role: "MANAGER", sectorId: ti.id, isActive: true });

    const result = await getAnalytics(PERIOD, prisma, now);
    expect(result.checklist).toEqual({
      withChecklist: 3,
      complete: 1,
      completePercentage: 33,
      skippedOptional: [
        { key: `${ti.id}:${repair.name}:Avisar o usuário`, label: `Avisar o usuário · ${repair.name}`, count: 2 },
        { key: `${ti.id}:${repair.name}:Fotografar`, label: `Fotografar · ${repair.name}`, count: 1 },
      ],
    });
  });

  it("the administrator filtering another sector sees only it", async () => {
    const { rh, admin } = await scenario();
    actAs({ id: admin.id, name: admin.name, role: "ADMIN", sectorId: null, isActive: true });

    const result = await getAnalytics({ ...PERIOD, sector: rh.id }, prisma, now);
    expect(result.checklist).toEqual({ withChecklist: 1, complete: 1, completePercentage: 100, skippedOptional: [] });
  });

  it("the administrator over the organization sees the sector next to each item", async () => {
    const { ti, repair, admin } = await scenario();
    actAs({ id: admin.id, name: admin.name, role: "ADMIN", sectorId: null, isActive: true });

    const result = await getAnalytics(PERIOD, prisma, now);
    // Other tests may leave checklists in the database: only this scenario's items are checked.
    expect(result.checklist.withChecklist).toBeGreaterThanOrEqual(4);
    expect(result.checklist.skippedOptional).toContainEqual({
      key: `${ti.id}:${repair.name}:Avisar o usuário`,
      label: `Avisar o usuário · ${repair.name} (${ti.name})`,
      count: 2,
    });
  });

  it("a period without completed requests with a checklist has none", async () => {
    const { ti, gabi } = await scenario();
    actAs({ id: gabi.id, name: gabi.name, role: "MANAGER", sectorId: ti.id, isActive: true });

    const result = await getAnalytics({ period: "custom", from: "2026-09-01", to: "2026-09-30" }, prisma, now);
    expect(result.checklist).toEqual({ withChecklist: 0, complete: 0, completePercentage: null, skippedOptional: [] });
  });
});
