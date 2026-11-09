import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { createDomainCategory, createDomainSector, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { createChecklistItem, getRequestChecklist, listQueuePageChecklists, markChecklistItem } from "@/modules/checklists";
import { createService } from "@/modules/services";
import { assumeRequest, createRequest, transitionRequestStatus } from "@/modules/requests";

// SPEC 2026-11-08-atendimento-dia-a-dia, 4.3 item 3 and 13.1 item 4 (SF-203; the marking of CA-CHK-03 and the
// note of CA-CHK-07).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });

async function scenario() {
  const sector = await createDomainSector();
  const other = await createDomainSector();
  const category = await createDomainCategory();
  const admin = await createDomainUser({ role: "ADMIN" });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const bia = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const caio = await createDomainUser({ role: "ATTENDANT", sectorId: other.id });
  const gabi = await createDomainUser({ role: "MANAGER", sectorId: sector.id });
  actAs(admin);
  const service = await createService({ name: `Instalação ${sector.id}`, description: "Instalação", categoryId: category.id, sectorId: sector.id }, prisma);
  await createChecklistItem(service.id, { text: "Instalar", isRequired: true });
  await createChecklistItem(service.id, { text: "Avisar", isRequired: false });
  actAs(rita);
  const request = await createRequest({ serviceId: service.id, description: "Novo notebook", fieldValues: {} }, prisma);
  return { sector, admin, rita, ana, bia, caio, gabi, service, request };
}

async function startAs(actor: Actor, requestId: string) {
  actAs(actor);
  await assumeRequest({ requestId }, prisma);
  await transitionRequestStatus({ requestId, toStatus: "IN_PROGRESS" }, prisma);
}

const itemsOf = (requestId: string) => prisma.requestChecklistItem.findMany({ where: { requestId }, orderBy: { position: "asc" } });

describe("marking a request's checklist (4.3 item 3; 13.1 item 4)", () => {
  it("the holder marks with a note and unmarks; each change is in the history", async () => {
    const { ana, request } = await scenario();
    await startAs(ana, request.id);
    const [install] = await itemsOf(request.id);

    await expect(markChecklistItem({ requestId: request.id, itemId: install.id, done: true, note: "  Versão 2.1  " })).resolves.toEqual({ changed: true });
    await expect(prisma.requestChecklistItem.findUniqueOrThrow({ where: { id: install.id } })).resolves.toMatchObject({ doneById: ana.id, note: "Versão 2.1" });
    // Marking again changes nothing and records nothing.
    await expect(markChecklistItem({ requestId: request.id, itemId: install.id, done: true })).resolves.toEqual({ changed: false });
    await markChecklistItem({ requestId: request.id, itemId: install.id, done: false });
    await expect(prisma.requestChecklistItem.findUniqueOrThrow({ where: { id: install.id } })).resolves.toMatchObject({ doneAt: null, doneById: null, note: null });

    const view = await getRequestChecklist(request.id);
    expect(view.events.map(({ action, itemText, note, actorName }) => ({ action, itemText, note, actorName }))).toEqual([
      { action: "DONE", itemText: "Instalar", note: "Versão 2.1", actorName: ana.name },
      { action: "UNDONE", itemText: "Instalar", note: null, actorName: ana.name },
    ]);
    expect(view).toMatchObject({ progress: { done: 0, total: 2 }, canMark: true });
    expect(view.pending.map(({ textSnapshot }) => textSnapshot)).toEqual(["Instalar"]);
  });

  it("a colleague who neither holds nor supervises is refused; a supervisor of the queue marks", async () => {
    const { admin, ana, bia, request } = await scenario();
    await startAs(ana, request.id);
    const [install] = await itemsOf(request.id);

    actAs(bia);
    await expect(markChecklistItem({ requestId: request.id, itemId: install.id, done: true })).rejects.toBeInstanceOf(ConflictError);
    expect((await getRequestChecklist(request.id)).canMark).toBe(false);

    await prisma.userPermission.create({ data: { userId: bia.id, permission: "QUEUE_SUPERVISION", grantedById: admin.id, grantedAt: new Date() } });
    await expect(markChecklistItem({ requestId: request.id, itemId: install.id, done: true })).resolves.toEqual({ changed: true });
    expect((await getRequestChecklist(request.id)).canMark).toBe(true);
  });

  it("only the team reads it: another sector's attendant and the requester are told it does not exist; the manager reads", async () => {
    const { rita, ana, caio, gabi, request } = await scenario();
    await startAs(ana, request.id);
    const [install] = await itemsOf(request.id);

    for (const actor of [caio, rita]) {
      actAs(actor);
      await expect(getRequestChecklist(request.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(markChecklistItem({ requestId: request.id, itemId: install.id, done: true })).rejects.toBeInstanceOf(NotFoundError);
    }
    actAs(gabi);
    await expect(getRequestChecklist(request.id)).resolves.toMatchObject({ canMark: false, progress: { done: 0, total: 2 } });
    await expect(markChecklistItem({ requestId: request.id, itemId: install.id, done: true })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("only while in attendance; an item of another request and a long note are refused", async () => {
    const { ana, rita, service, request } = await scenario();
    await startAs(ana, request.id);
    const [install, notice] = await itemsOf(request.id);
    actAs(rita);
    const second = await createRequest({ serviceId: service.id, description: "Outro", fieldValues: {} }, prisma);
    await startAs(ana, second.id);
    const [foreign] = await itemsOf(second.id);

    await expect(markChecklistItem({ requestId: request.id, itemId: foreign.id, done: true })).rejects.toBeInstanceOf(NotFoundError);
    await expect(markChecklistItem({ requestId: request.id, itemId: install.id, done: true, note: "x".repeat(201) })).rejects.toBeInstanceOf(ValidationError);

    await markChecklistItem({ requestId: request.id, itemId: install.id, done: true });
    await transitionRequestStatus({ requestId: request.id, toStatus: "COMPLETED" }, prisma);
    // A completed request's checklist no longer changes (CA-CHK-04).
    await expect(markChecklistItem({ requestId: request.id, itemId: notice.id, done: true })).rejects.toBeInstanceOf(ConflictError);
    expect((await getRequestChecklist(request.id)).canMark).toBe(false);
  });

  it("a request without a checklist reads as none", async () => {
    const { ana, request } = await scenario();
    actAs(ana);
    await expect(getRequestChecklist(request.id)).resolves.toEqual({ items: null, progress: null, pending: [], events: [], canMark: false });
  });
});

// SPEC 2026-11-08-atendimento-dia-a-dia, 13.1 item 3 (SF-226; CA-CHK-07).
describe("the checklist's progress in the queue's list", () => {
  it("marked over total for the attendant's sector's requests that have items; nothing for others", async () => {
    const { rita, ana, caio, gabi, service, request } = await scenario();
    await startAs(ana, request.id);
    const [install] = await itemsOf(request.id);
    await markChecklistItem({ requestId: request.id, itemId: install.id, done: true });
    actAs(rita);
    const waiting = await createRequest({ serviceId: service.id, description: "Ainda aberta", fieldValues: {} }, prisma);

    actAs(ana);
    const progress = await listQueuePageChecklists([request.id, waiting.id]);
    expect([...progress.entries()]).toEqual([[request.id, { done: 1, total: 2 }]]);

    // Another sector's attendant and the manager read nothing here.
    for (const actor of [caio, gabi]) {
      actAs(actor);
      expect((await listQueuePageChecklists([request.id])).size).toBe(0);
    }
  });
});
