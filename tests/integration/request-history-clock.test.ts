import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./fixtures";
import {
  createDomainCategory,
  createDomainSector,
  createDomainService,
  createDomainUser,
} from "./domain-fixtures";

const authorization = vi.hoisted(() => ({
  requireRequestCreator: vi.fn(),
  requireStatusChangeActor: vi.fn(),
}));

vi.mock("@/server/authorization", () => authorization);

import { createRequest, transitionRequestStatus } from "@/modules/requests";

const HOUR = 60 * 60 * 1000;

async function databaseNow(): Promise<number> {
  const [row] = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`;
  return row.now.getTime();
}

// SPEC 2026-09-30, section 23: every request and status event time comes from the database.
describe("request history uses the database clock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["ahead of", HOUR],
    ["behind", -HOUR],
  ])(
    "keeps the history ordered when the application clock is an hour %s the database (CA-HOR-03)",
    async (_label, offset) => {
      const requester = await createDomainUser({ role: "REQUESTER" });
      const sector = await createDomainSector();
      const attendant = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
      const category = await createDomainCategory();
      const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
      authorization.requireRequestCreator.mockResolvedValue(requester);
      authorization.requireStatusChangeActor.mockResolvedValue({
        actorId: attendant.id,
        sectorId: sector.id,
      });

      // Only Date is faked: Prisma and the database keep their real timers and clock.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + offset);

      const before = await databaseNow();
      const created = await createRequest(
        { serviceId: service.id, description: "Clock check" },
        prisma,
      );
      await transitionRequestStatus({ requestId: created.id, toStatus: "IN_PROGRESS" }, prisma);
      const completed = await transitionRequestStatus(
        { requestId: created.id, toStatus: "COMPLETED" },
        prisma,
      );
      const after = await databaseNow();

      // CA-HOR-01: one opening time.
      expect(created.createdAt).toEqual(created.updatedAt);
      expect(created.events[0].occurredAt).toEqual(created.createdAt);

      // CA-HOR-02: one time per transition.
      const [opened, started, finished] = completed.events;
      expect(completed.events.map(({ toStatus }) => toStatus)).toEqual([
        "OPEN",
        "IN_PROGRESS",
        "COMPLETED",
      ]);
      expect(completed.updatedAt).toEqual(finished.occurredAt);
      expect(completed.completedAt).toEqual(finished.occurredAt);

      // CA-HOR-03: ordered and taken from the database clock, not the shifted application clock.
      expect(opened.occurredAt.getTime()).toBeLessThanOrEqual(started.occurredAt.getTime());
      expect(started.occurredAt.getTime()).toBeLessThanOrEqual(finished.occurredAt.getTime());
      for (const event of completed.events) {
        expect(event.occurredAt.getTime()).toBeGreaterThanOrEqual(before - 1);
        expect(event.occurredAt.getTime()).toBeLessThanOrEqual(after);
      }
    },
  );
});
