import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";
import { encryptWebhookSecret, generateWebhookSecret } from "@/modules/webhooks";

// SPEC 2026-11-03-pausa-sla-calendario, section 6 (SF-128).

const at = (iso: string) => new Date(iso);

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const requester = await createDomainUser({ role: "REQUESTER" });
  const attendant = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const request = await createDomainRequest({ requesterId: requester.id, serviceId: service.id, sectorId: sector.id });
  return { service, requester, attendant, request };
}

describe("SLA pause and calendar schema (SF-128)", () => {
  it("leaves services and requests in calendar hours and without a pause", async () => {
    const { service, request } = await scenario();

    await expect(prisma.service.findUniqueOrThrow({ where: { id: service.id } })).resolves.toMatchObject({ slaBusinessHours: false });
    await expect(prisma.request.findUniqueOrThrow({ where: { id: request.id } })).resolves.toMatchObject({ slaBusinessHours: false, slaPausedAt: null });
  });

  it("allows a paused SLA only on a request in progress with a running deadline", async () => {
    const { request } = await scenario();
    const pause = (data: Record<string, unknown>) => prisma.request.update({ where: { id: request.id }, data: { slaPausedAt: new Date(), ...data } });

    await expect(pause({})).rejects.toThrow();
    await expect(pause({ status: "IN_PROGRESS" })).rejects.toThrow();
    await expect(pause({ status: "IN_PROGRESS", slaHoursSnapshot: 4, dueAt: at("2026-11-09T13:00:00Z") })).resolves.toMatchObject({ status: "IN_PROGRESS" });
    await expect(prisma.request.update({ where: { id: request.id }, data: { status: "COMPLETED", completedAt: new Date() } })).rejects.toThrow();
  });

  it("keeps the rules of a pause row", async () => {
    const { requester, attendant, request } = await scenario();
    const create = (data: Record<string, unknown> = {}) =>
      prisma.requestSlaPause.create({
        data: { requestId: request.id, pausedById: attendant.id, reason: "Falta o patrimônio", pausedAt: at("2026-11-06T15:00:00Z"), ...data },
      });

    for (const data of [
      { reason: "" },
      { reason: " com espaço" },
      { reason: "x".repeat(501) },
      { resumedAt: at("2026-11-06T16:00:00Z") },
      { resumedAt: at("2026-11-06T16:00:00Z"), resumedById: attendant.id },
      { resumedAt: at("2026-11-06T14:00:00Z"), resumedById: attendant.id, resumeCause: "MANUAL" },
    ]) {
      await expect(create(data), JSON.stringify(data).slice(0, 60)).rejects.toThrow();
    }

    const open = await create();
    // A second open pause for the same request is refused; closed ones may pile up.
    await expect(create()).rejects.toThrow();
    await prisma.requestSlaPause.update({
      where: { id: open.id },
      data: { resumedAt: at("2026-11-06T16:00:00Z"), resumedById: requester.id, resumeCause: "REQUESTER_REPLY" },
    });
    await expect(create({ reason: "x".repeat(500) })).resolves.toMatchObject({ resumedAt: null });
  });

  it("keeps a single calendar row with valid weekdays and window", async () => {
    const save = (data: Record<string, unknown>) =>
      prisma.businessCalendar.upsert({
        where: { id: (data.id as number | undefined) ?? 1 },
        create: { weekdays: [1, 2, 3, 4, 5], startMinute: 480, endMinute: 1080, timeZone: "America/Sao_Paulo", ...data },
        update: { weekdays: [1, 2, 3, 4, 5], startMinute: 480, endMinute: 1080, timeZone: "America/Sao_Paulo", ...data },
      });

    for (const data of [
      { id: 2 },
      { weekdays: [] },
      { weekdays: [0, 1] },
      { weekdays: [8] },
      { startMinute: 600, endMinute: 600 },
      { startMinute: -1 },
      { endMinute: 1441 },
      { timeZone: "" },
    ]) {
      await expect(save(data), JSON.stringify(data)).rejects.toThrow();
    }

    await expect(save({ weekdays: [6, 7], startMinute: 0, endMinute: 1440 })).resolves.toMatchObject({ id: 1, weekdays: [6, 7] });
    await expect(prisma.businessCalendar.count()).resolves.toBe(1);
  });

  it("keeps one holiday per date with a trimmed name", async () => {
    const admin = await createDomainUser({ role: "ADMIN" });
    const create = (data: Record<string, unknown>) =>
      prisma.businessHoliday.create({ data: { day: at("2026-12-25T00:00:00Z"), name: "Natal", yearly: true, createdById: admin.id, ...data } });

    await expect(create({ name: "" })).rejects.toThrow();
    await expect(create({ name: " Natal" })).rejects.toThrow();
    await expect(create({ name: "n".repeat(81) })).rejects.toThrow();
    await expect(create({})).resolves.toMatchObject({ yearly: true });
    await expect(create({ name: "Outro" })).rejects.toThrow();
  });

  it("computes 'due soon' in calendar hours and keeps the written value in business hours", async () => {
    const { request } = await scenario();
    const due = at("2026-11-09T13:00:00Z");

    // Calendar hours: 4 h NORMAL = 48 minutes before the due date, whatever the application writes.
    await expect(
      prisma.request.update({ where: { id: request.id }, data: { slaHoursSnapshot: 4, dueAt: due, dueSoonAt: at("2000-01-01T00:00:00Z") } }),
    ).resolves.toMatchObject({ dueSoonAt: at("2026-11-09T12:12:00Z") });

    // Business hours: the application's value stays, also on later writes of the due date.
    const business = at("2026-11-06T20:00:00Z");
    await expect(
      prisma.request.update({ where: { id: request.id }, data: { slaBusinessHours: true, dueSoonAt: business } }),
    ).resolves.toMatchObject({ dueSoonAt: business });
    await expect(prisma.request.update({ where: { id: request.id }, data: { priority: "HIGH" } })).resolves.toMatchObject({ dueSoonAt: business });

    // Without a due date there is no "due soon" in either clock.
    await expect(prisma.request.update({ where: { id: request.id }, data: { dueAt: null, slaHoursSnapshot: null } })).resolves.toMatchObject({
      dueSoonAt: null,
    });
  });

  it("accepts the pause events in the outbox and in webhooks, and the new audit values", async () => {
    const { request } = await scenario();
    const key = randomBytes(32);

    for (const type of ["request.sla_paused", "request.sla_resumed"]) {
      await expect(
        prisma.outboxEvent.create({ data: { type, requestId: request.id, occurredAt: new Date(), availableAt: new Date(), payload: {} } }),
      ).resolves.toMatchObject({ type });
    }
    await expect(
      prisma.webhookEndpoint.create({
        data: {
          name: "Pausas",
          url: "https://hooks.exemplo.com/pausas",
          eventTypes: ["request.sla_paused", "request.sla_resumed"],
          encryptedSecret: encryptWebhookSecret(generateWebhookSecret(), key),
        },
      }),
    ).resolves.toMatchObject({ name: "Pausas" });
    await expect(
      prisma.auditEntry.create({
        data: {
          actorId: "admin",
          actorRole: "ADMIN",
          action: "DELETED",
          entityType: "HOLIDAY",
          entityId: "00000000-0000-4000-8000-000000000002",
          entityLabel: "Natal",
        },
      }),
    ).resolves.toMatchObject({ entityType: "HOLIDAY" });
  });
});
