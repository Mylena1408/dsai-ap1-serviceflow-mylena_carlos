import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { runOutbox } from "@/modules/events";
import { notificationConsumer } from "@/modules/notifications";
import { addComment, listComments } from "@/modules/comments";
import {
  assumeRequest,
  createRequest,
  getAttendantRequest,
  getRequesterRequest,
  listSectorDestinations,
  searchAttendantQueue,
  sendRequestToSector,
} from "@/modules/requests";
import { anonymizeUser } from "@/modules/users";
import { createMemoryDocumentStorage } from "@/server/storage";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { GET as downloadPersonalData } from "@/app/api/account/data/route";

// SPEC 2026-11-03-transferencia-entre-setores over the database (SF-121; CA-SET-02 to 05 and 08).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };

function actAs(actor: Actor) {
  session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
}

async function scenario() {
  const reception = await prisma.sector.create({ data: { name: `Atendimento ${crypto.randomUUID().slice(0, 8)}` } });
  const maintenance = await prisma.sector.create({ data: { name: `Manutenção ${crypto.randomUUID().slice(0, 8)}` } });
  const empty = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: reception.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: reception.id });
  const bia = await createDomainUser({ role: "ATTENDANT", sectorId: reception.id });
  const caio = await createDomainUser({ role: "ATTENDANT", sectorId: maintenance.id });
  const eva = await createDomainUser({ role: "ATTENDANT", sectorId: maintenance.id });
  const admin = await createDomainUser({ role: "ADMIN" });
  actAs(rita);
  const request = await createRequest({ serviceId: service.id, description: "Cadeira quebrada na sala 3" }, prisma);
  return { reception, maintenance, empty, rita, ana, bia, caio, eva, admin, request };
}

const process = () => runOutbox([notificationConsumer(prisma)], { maxBatches: 5 }, prisma);

describe("sending a request to another sector (SF-121)", () => {
  it("moves it with history, releases the assignee and changes who reads it (CA-SET-02 and 04)", async () => {
    const { reception, maintenance, empty, rita, ana, caio, request } = await scenario();
    actAs(ana);
    await assumeRequest({ requestId: request.id }, prisma);
    await addComment({ requestId: request.id, body: "Nota da recepção", isInternal: true }, prisma);
    const before = await prisma.request.findUniqueOrThrow({ where: { id: request.id } });

    // Only sectors with an active attendant are offered (decision T4).
    const destinations = await listSectorDestinations(request.id, prisma);
    expect(destinations.map(({ id }) => id)).toContain(maintenance.id);
    expect(destinations.map(({ id }) => id)).not.toContain(empty.id);
    expect(destinations.map(({ id }) => id)).not.toContain(reception.id);

    await sendRequestToSector({ requestId: request.id, sectorId: maintenance.id, note: " Pedido é da manutenção " }, prisma);

    const after = await prisma.request.findUniqueOrThrow({ where: { id: request.id } });
    expect(after).toMatchObject({
      sectorId: maintenance.id,
      sectorNameSnapshot: maintenance.name,
      assigneeId: null,
      status: "OPEN",
      priority: before.priority,
      dueAt: before.dueAt,
      serviceNameSnapshot: before.serviceNameSnapshot,
    });
    await expect(prisma.requestSectorEvent.findMany({ where: { requestId: request.id } })).resolves.toMatchObject([
      {
        actorId: ana.id,
        fromSectorId: reception.id,
        toSectorId: maintenance.id,
        fromSectorName: reception.name,
        toSectorName: maintenance.name,
        note: "Pedido é da manutenção",
      },
    ]);
    const outbox = await prisma.outboxEvent.findMany({ where: { requestId: request.id }, orderBy: { occurredAt: "asc" } });
    expect(outbox.map(({ type }) => type)).toEqual(
      expect.arrayContaining(["request.assignment_changed", "request.sector_changed"]),
    );
    expect(outbox.find(({ type }) => type === "request.sector_changed")?.payload).toEqual({
      fromSectorId: reception.id,
      toSectorId: maintenance.id,
      actorId: ana.id,
    });

    // The previous sector no longer reads it.
    await expect(getAttendantRequest(request.id, prisma)).rejects.toThrow(NotFoundError);

    // The new sector finds it in the queue, with the whole history and the internal note.
    actAs(caio);
    const queue = await searchAttendantQueue({}, prisma);
    expect(queue.items.map(({ id }) => id)).toContain(request.id);
    const seen = await getAttendantRequest(request.id, prisma);
    expect(seen.sectorEvents).toHaveLength(1);
    expect(seen.assignmentEvents.map(({ toAssigneeId }) => toAssigneeId)).toEqual([ana.id, null]);
    expect((await listComments(request.id, prisma)).map(({ body }) => body)).toContain("Nota da recepção");

    // The requester sees the new sector and the line with the reason.
    actAs(rita);
    const own = await getRequesterRequest(request.id, prisma);
    expect(own.sectorNameSnapshot).toBe(maintenance.name);
    expect(own.sectorEvents?.[0]).toMatchObject({ note: "Pedido é da manutenção", toSectorName: maintenance.name });
  });

  it("refuses with the codes of the screen and changes nothing (CA-SET-03)", async () => {
    const { maintenance, empty, rita, ana, bia, caio, request } = await scenario();
    const send = (input: Record<string, unknown> = {}) =>
      sendRequestToSector({ requestId: request.id, sectorId: maintenance.id, note: "Outro setor", ...input }, prisma);

    actAs(ana);
    await expect(send({ note: "" })).rejects.toThrow(ValidationError);
    await expect(send({ sectorId: empty.id })).rejects.toThrow(ValidationError);
    await assumeRequest({ requestId: request.id }, prisma);

    actAs(bia);
    await expect(send()).rejects.toThrow(ConflictError);
    actAs(caio);
    await expect(send()).rejects.toThrow(NotFoundError);
    actAs(rita);
    await expect(send()).rejects.toThrow(NotFoundError);

    await prisma.request.update({ where: { id: request.id }, data: { approvalState: "PENDING" } });
    actAs(ana);
    await expect(send()).rejects.toThrow(ConflictError);

    await expect(prisma.requestSectorEvent.count({ where: { requestId: request.id } })).resolves.toBe(0);
    await expect(prisma.request.findUniqueOrThrow({ where: { id: request.id } })).resolves.toMatchObject({ assigneeId: ana.id });
  });

  it("lets only one of two simultaneous moves happen", async () => {
    const { maintenance, ana, bia, request } = await scenario();
    const send = (actor: Actor) => {
      actAs(actor);
      return sendRequestToSector({ requestId: request.id, sectorId: maintenance.id, note: "Outro setor" }, prisma);
    };

    const results = await Promise.allSettled([send(ana), send(bia)]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const refusal = results.find(({ status }) => status === "rejected") as PromiseRejectedResult;
    expect(refusal.reason instanceof ConflictError || refusal.reason instanceof NotFoundError).toBe(true);
    await expect(prisma.requestSectorEvent.count({ where: { requestId: request.id } })).resolves.toBe(1);
  });

  it("notifies the receiving team and the requester, not the author (CA-SET-05)", async () => {
    const { maintenance, rita, ana, caio, eva, request } = await scenario();
    await process();
    actAs(ana);
    await sendRequestToSector({ requestId: request.id, sectorId: maintenance.id, note: "Outro setor" }, prisma);

    await process();

    const notified = await prisma.requestNotification.findMany({
      where: { requestId: request.id, type: { in: ["sector.received", "sector.changed"] } },
      select: { recipientId: true, type: true },
    });
    expect(notified).toEqual(
      expect.arrayContaining([
        { recipientId: caio.id, type: "sector.received" },
        { recipientId: eva.id, type: "sector.received" },
        { recipientId: rita.id, type: "sector.changed" },
      ]),
    );
    expect(notified).toHaveLength(3);
  });

  it("puts the move in the requester's data and removes the reason on anonymization (CA-SET-08)", async () => {
    const { maintenance, rita, ana, admin, request } = await scenario();
    actAs(ana);
    await sendRequestToSector({ requestId: request.id, sectorId: maintenance.id, note: "Pedido é da manutenção" }, prisma);

    actAs(rita);
    const file = JSON.parse(await (await downloadPersonalData()).text());
    expect(file.solicitacoesQueVoceAbriu[0].encaminhamentos).toEqual([
      expect.objectContaining({ para: maintenance.name, por: ana.name, justificativa: "Pedido é da manutenção" }),
    ]);

    await prisma.user.update({ where: { id: ana.id }, data: { isActive: false } });
    actAs(admin);
    await anonymizeUser({ userId: ana.id, confirmed: true }, prisma, createMemoryDocumentStorage());
    await expect(prisma.requestSectorEvent.findFirstOrThrow({ where: { requestId: request.id } })).resolves.toMatchObject({
      note: "[conteúdo removido na anonimização]",
    });
  });
});
