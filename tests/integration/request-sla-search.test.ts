import { describe, expect, it, vi } from "vitest";
import type { RequestPriority, RequestStatus, Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { ValidationError } from "@/server/errors";
import {
  createDomainCategory,
  createDomainRequest,
  createDomainSector,
  createDomainService,
  createDomainUser,
} from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { searchAttendantQueue, searchRequesterRequests, slaSituation } from "@/modules/requests";

// SPEC 2026-11-01-sla-prioridades, sections 5.4 and 5.6 (SF-068).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

function actAs(actor: Actor) {
  session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
}

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const owner = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });

  /** A request of the sector; `dueInMs` is relative to now, null means no SLA. */
  async function add(description: string, dueInMs: number | null, status: RequestStatus = "OPEN", createdAgoMs = HOUR) {
    const request = await createDomainRequest({ requesterId: owner.id, serviceId: service.id, sectorId: sector.id });
    const now = Date.now();
    return prisma.request.update({
      where: { id: request.id },
      data: {
        description,
        status,
        createdAt: new Date(now - createdAgoMs),
        slaHoursSnapshot: dueInMs === null ? null : 10,
        dueAt: dueInMs === null ? null : new Date(now + dueInMs),
        ...(status === "CANCELLED" ? { cancelledAt: new Date(now) } : {}),
        ...(status === "COMPLETED" ? { completedAt: new Date(now), completedLate: dueInMs !== null ? false : null } : {}),
      },
    });
  }

  return { owner, ana, add };
}

const descriptions = (result: { items: Array<{ description: string }> }) => result.items.map(({ description }) => description);

describe("due-soon instant kept by the database (SF-068)", () => {
  it("matches the domain rule for every priority, on insert and on later changes", async () => {
    const { add } = await scenario();
    const request = await add("prazo", 5 * HOUR);
    const windows: Record<RequestPriority, number> = { URGENT: 30, HIGH: 60, NORMAL: 120, LOW: 240 };

    for (const priority of ["URGENT", "HIGH", "NORMAL", "LOW"] as const) {
      const row = await prisma.request.update({ where: { id: request.id }, data: { priority } });
      expect(row.dueAt!.getTime() - row.dueSoonAt!.getTime()).toBe(windows[priority] * MINUTE);
      // Just before dueSoonAt the screen says "on time"; at it, "due soon".
      const state = { ...row, status: "OPEN" as const };
      expect(slaSituation(state, new Date(row.dueSoonAt!.getTime() - 1))).toBe("on_time");
      expect(slaSituation(state, row.dueSoonAt!)).toBe("due_soon");
    }

    const forged = await prisma.request.update({ where: { id: request.id }, data: { dueSoonAt: new Date(0) } });
    expect(forged.dueSoonAt!.getTime()).toBe(forged.dueAt!.getTime() - 240 * MINUTE);
    const cleared = await prisma.request.update({
      where: { id: request.id },
      data: { slaHoursSnapshot: null, dueAt: null },
    });
    expect(cleared.dueSoonAt).toBeNull();
  });
});

describe("queue SLA filter and order (CA-SLA-09)", () => {
  it("filters by situation with the same rules as the screen", async () => {
    const { ana, add } = await scenario();
    await add("dentro", 5 * HOUR);
    await add("proximo", 90 * MINUTE);
    await add("vencido", -MINUTE, "IN_PROGRESS");
    await add("sem prazo", null);
    await add("cancelada", 5 * HOUR, "CANCELLED");
    await add("concluida", -HOUR, "COMPLETED");
    actAs(ana);

    const bySla = async (sla: string) => descriptions(await searchAttendantQueue({ sla }, prisma));
    expect(await bySla("on_time")).toEqual(["dentro"]);
    expect(await bySla("due_soon")).toEqual(["proximo"]);
    expect(await bySla("overdue")).toEqual(["vencido"]);
    expect((await bySla("none")).sort()).toEqual(["cancelada", "sem prazo"]);
    await expect(searchAttendantQueue({}, prisma)).resolves.toMatchObject({ total: 6 });
  });

  it("orders by nearest due date with requests without SLA last", async () => {
    const { ana, add } = await scenario();
    await add("sem prazo antiga", null, "OPEN", 3 * HOUR);
    await add("vence depois", 5 * HOUR);
    await add("vencida", -MINUTE);
    await add("sem prazo nova", null, "OPEN", HOUR);
    await add("vence logo", 90 * MINUTE);
    actAs(ana);

    expect(descriptions(await searchAttendantQueue({ order: "due" }, prisma))).toEqual([
      "vencida",
      "vence logo",
      "vence depois",
      "sem prazo antiga",
      "sem prazo nova",
    ]);
  });

  it("combines with search, status and pages, and stays out of the requester list", async () => {
    const { owner, ana, add } = await scenario();
    for (let index = 0; index < 22; index += 1) {
      await add(`impressora ${String(index).padStart(2, "0")}`, (index + 1) * 3 * HOUR);
    }
    await add("cadeira", 5 * HOUR);
    actAs(ana);

    const firstPage = await searchAttendantQueue({ q: "impressora", sla: "on_time", status: "OPEN", order: "due" }, prisma);
    expect(firstPage).toMatchObject({ total: 22, page: 1, pageCount: 2 });
    expect(descriptions(firstPage)[0]).toBe("impressora 00");
    const secondPage = await searchAttendantQueue({ q: "impressora", sla: "on_time", order: "due", page: "2" }, prisma);
    expect(descriptions(secondPage)).toEqual(["impressora 20", "impressora 21"]);
    await expect(searchAttendantQueue({ sla: "late" }, prisma)).rejects.toBeInstanceOf(ValidationError);

    actAs(owner);
    await expect(searchRequesterRequests({ sla: "overdue" }, prisma)).resolves.toMatchObject({ total: 23 });
    await expect(searchRequesterRequests({ order: "due" }, prisma)).rejects.toBeInstanceOf(ValidationError);
  });
});
