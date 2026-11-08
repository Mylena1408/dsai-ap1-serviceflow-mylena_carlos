import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-07-operacao-e-automacao, 5.3 items 2 and 3 and 5.4 (SF-184; CA-REC-02 and 06 by the database).

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const gabi = await createDomainUser({ role: "MANAGER", sectorId: sector.id });
  const base = {
    name: "Limpeza do ar",
    serviceId: service.id,
    requesterId: rita.id,
    createdById: gabi.id,
    description: "Manutenção preventiva",
    startsOn: day("2026-11-09"),
  };
  return { sector, service, rita, base };
}

describe("schedule values (5.3 item 2)", () => {
  it("a weekly schedule has its weekdays; a monthly one its day from 1 to 28", async () => {
    const { base } = await scenario();
    await expect(prisma.recurringRequest.create({ data: { ...base, frequency: "WEEKLY", weekdays: [1, 3] } })).resolves.toMatchObject({
      monthDay: null,
      answers: {},
      consecutiveFailures: 0,
      pausedAt: null,
      endedAt: null,
    });
    await expect(prisma.recurringRequest.create({ data: { ...base, frequency: "MONTHLY", monthDay: 28 } })).resolves.toMatchObject({ weekdays: [] });

    const refused: Prisma.RecurringRequestUncheckedCreateInput[] = [
      { ...base, frequency: "WEEKLY", weekdays: [] },
      { ...base, frequency: "WEEKLY", weekdays: [0] },
      { ...base, frequency: "WEEKLY", weekdays: [8] },
      { ...base, frequency: "WEEKLY", weekdays: [1, 1] },
      { ...base, frequency: "WEEKLY", weekdays: [1], monthDay: 5 },
      { ...base, frequency: "MONTHLY" },
      { ...base, frequency: "MONTHLY", monthDay: 0 },
      { ...base, frequency: "MONTHLY", monthDay: 29 },
      { ...base, frequency: "MONTHLY", monthDay: 5, weekdays: [1] },
      { ...base, name: " Limpeza", frequency: "MONTHLY", monthDay: 5 },
      { ...base, name: "", frequency: "MONTHLY", monthDay: 5 },
      { ...base, name: "x".repeat(81), frequency: "MONTHLY", monthDay: 5 },
      { ...base, description: "  ", frequency: "MONTHLY", monthDay: 5 },
      { ...base, frequency: "MONTHLY", monthDay: 5, endsOn: day("2026-11-08") },
      { ...base, frequency: "MONTHLY", monthDay: 5, endsOn: day("2028-11-10") },
      { ...base, frequency: "MONTHLY", monthDay: 5, consecutiveFailures: -1 },
      { ...base, frequency: "MONTHLY", monthDay: 5, answers: ["x"] },
    ];
    for (const data of refused) {
      await expect(prisma.recurringRequest.create({ data })).rejects.toThrow(/RecurringRequest_values_check/);
    }
    await expect(
      prisma.recurringRequest.create({ data: { ...base, frequency: "MONTHLY", monthDay: 5, endsOn: day("2028-11-09") } }),
    ).resolves.toMatchObject({ endsOn: day("2028-11-09") });
  });
});

describe("schedule runs (5.3 item 3)", () => {
  it("an opened run has its request; a skipped one its reason; one run per day", async () => {
    const { sector, service, rita, base } = await scenario();
    const schedule = await prisma.recurringRequest.create({ data: { ...base, frequency: "WEEKLY", weekdays: [1] } });
    const request = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: sector.id });
    const run = { recurringRequestId: schedule.id, occurredAt: new Date() };

    await expect(
      prisma.recurringRequestRun.create({ data: { ...run, scheduledOn: day("2026-11-09"), outcome: "OPENED", requestId: request.id } }),
    ).resolves.toMatchObject({ reason: null });
    await expect(
      prisma.recurringRequestRun.create({ data: { ...run, scheduledOn: day("2026-11-16"), outcome: "SKIPPED", reason: "FORM_CHANGED" } }),
    ).resolves.toMatchObject({ requestId: null });

    for (const data of [
      { ...run, scheduledOn: day("2026-11-23"), outcome: "OPENED" as const },
      { ...run, scheduledOn: day("2026-11-23"), outcome: "OPENED" as const, requestId: request.id, reason: "FORM_CHANGED" as const },
      { ...run, scheduledOn: day("2026-11-23"), outcome: "SKIPPED" as const },
      { ...run, scheduledOn: day("2026-11-23"), outcome: "SKIPPED" as const, reason: "REQUESTER_INACTIVE" as const, requestId: request.id },
    ]) {
      await expect(prisma.recurringRequestRun.create({ data })).rejects.toThrow(/RecurringRequestRun_outcome_check/);
    }
    await expect(
      prisma.recurringRequestRun.create({ data: { ...run, scheduledOn: day("2026-11-09"), outcome: "SKIPPED", reason: "SERVICE_UNAVAILABLE" } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("a request knows the schedule that opened it, and the schedule cannot be deleted under it", async () => {
    const { sector, service, rita, base } = await scenario();
    const schedule = await prisma.recurringRequest.create({ data: { ...base, frequency: "MONTHLY", monthDay: 10 } });
    const request = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: sector.id });
    expect(request).toMatchObject({ recurringRequestId: null });

    await prisma.request.update({ where: { id: request.id }, data: { recurringRequestId: schedule.id } });
    expect(await prisma.request.count({ where: { recurringRequestId: schedule.id } })).toBe(1);
    await expect(prisma.recurringRequest.delete({ where: { id: schedule.id } })).rejects.toThrow();
  });
});
