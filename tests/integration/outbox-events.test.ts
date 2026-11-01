import { afterEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import {
  createDomainCategory,
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

import { addComment } from "@/modules/comments";
import {
  assumeRequest,
  cancelRequest,
  createRequest,
  reopenRequest,
  transitionRequestStatus,
} from "@/modules/requests";

// SPEC 2026-10-31-eventos-outbox-jobs (SF-061): one event per action, in the same transaction.

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };

function actAs(actor: Actor) {
  session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
}

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const owner = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  return { sector, service, owner, ana };
}

const events = () => prisma.outboxEvent.findMany({ orderBy: [{ occurredAt: "asc" }, { type: "asc" }] });

async function failOutboxInserts() {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION public.reject_serviceflow_outbox()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'integration outbox failure';
    END;
    $$;
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER reject_serviceflow_outbox
    BEFORE INSERT ON public."OutboxEvent"
    FOR EACH ROW EXECUTE FUNCTION public.reject_serviceflow_outbox();
  `);
}

describe("outbox events (SF-061)", () => {
  afterEach(async () => {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS reject_serviceflow_outbox ON public."OutboxEvent";`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS public.reject_serviceflow_outbox();`);
  });

  it("records exactly one event per action with identifiers only (CA-EVT-01, 02)", async () => {
    const { sector, service, owner, ana } = await scenario();

    actAs(owner);
    const request = await createRequest({ serviceId: service.id, description: "Cadeira solta" }, prisma);
    await addComment({ requestId: request.id, body: "Texto que não pode ir para o evento" }, prisma);
    actAs(ana);
    await assumeRequest({ requestId: request.id }, prisma);
    await transitionRequestStatus({ requestId: request.id, toStatus: "IN_PROGRESS" }, prisma);
    await transitionRequestStatus({ requestId: request.id, toStatus: "COMPLETED" }, prisma);
    actAs(owner);
    await reopenRequest({ requestId: request.id, note: "Justificativa que não pode ir" }, prisma);
    await cancelRequest({ requestId: request.id }, prisma);

    const recorded = await events();
    expect(recorded.map(({ type }) => type)).toEqual([
      "request.opened",
      "request.comment_added",
      "request.assignment_changed",
      "request.status_changed",
      "request.status_changed",
      "request.status_changed",
      "request.status_changed",
    ]);
    expect(recorded[0].payload).toEqual({ requesterId: owner.id, sectorId: sector.id });
    expect(recorded[2].payload).toEqual({ fromAssigneeId: null, toAssigneeId: ana.id, actorId: ana.id });
    expect(recorded.slice(3).map(({ payload }) => payload)).toEqual([
      { fromStatus: "OPEN", toStatus: "IN_PROGRESS", actorId: ana.id },
      { fromStatus: "IN_PROGRESS", toStatus: "COMPLETED", actorId: ana.id },
      { fromStatus: "COMPLETED", toStatus: "OPEN", actorId: owner.id },
      { fromStatus: "OPEN", toStatus: "CANCELLED", actorId: owner.id },
    ]);

    const serialized = JSON.stringify(recorded.map(({ payload }) => payload));
    expect(serialized).not.toContain("Texto que não pode");
    expect(serialized).not.toContain("Justificativa");
    expect(serialized).not.toContain("Cadeira");
    for (const event of recorded) {
      expect(event).toMatchObject({ requestId: request.id, attempts: 0, processedAt: null, failedAt: null });
      expect(event.availableAt).toEqual(event.occurredAt);
    }

    const history = await prisma.requestStatusEvent.findMany({ where: { requestId: request.id }, orderBy: { occurredAt: "asc" } });
    expect(recorded[0].occurredAt).toEqual(history[0].occurredAt);
  });

  it("rolls the whole action back when the event cannot be written (CA-EVT-01)", async () => {
    const { service, owner, ana } = await scenario();
    actAs(owner);
    const request = await createRequest({ serviceId: service.id, description: "Antes da falha" }, prisma);
    await failOutboxInserts();

    await expect(createRequest({ serviceId: service.id, description: "Falha" }, prisma)).rejects.toThrow();
    await expect(addComment({ requestId: request.id, body: "Falha" }, prisma)).rejects.toThrow();
    actAs(ana);
    await expect(assumeRequest({ requestId: request.id }, prisma)).rejects.toThrow();

    await expect(prisma.request.count()).resolves.toBe(1);
    await expect(prisma.requestComment.count()).resolves.toBe(0);
    await expect(prisma.request.findUniqueOrThrow({ where: { id: request.id } })).resolves.toMatchObject({
      assigneeId: null,
    });
    await expect(prisma.requestAssignmentEvent.count()).resolves.toBe(0);
    await expect(prisma.outboxEvent.count()).resolves.toBe(1);
  });

  it("accepts only the known event types (database CHECK)", async () => {
    const { service, owner } = await scenario();
    actAs(owner);
    const request = await createRequest({ serviceId: service.id, description: "Base" }, prisma);
    const now = new Date();

    await expect(
      prisma.outboxEvent.create({
        data: { type: "request.deleted", requestId: request.id, payload: {}, occurredAt: now, availableAt: now },
      }),
    ).rejects.toThrow();
  });
});
