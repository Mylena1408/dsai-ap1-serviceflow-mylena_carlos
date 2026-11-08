import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainSector, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { createChecklistItem, setChecklistItemActive, updateChecklistItem } from "@/modules/checklists";
import { createServiceField } from "@/modules/service-fields";
import { createService } from "@/modules/services";
import { assumeRequest, createRequest, reopenRequest, transitionRequestStatus } from "@/modules/requests";

// SPEC 2026-11-08-atendimento-dia-a-dia, 4.3 item 2 and 13.1 item 1 (SF-202; CA-CHK-01, the copy of CA-CHK-03 and
// CA-CHK-06).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const admin = await createDomainUser({ role: "ADMIN" });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  actAs(admin);
  const service = await createService({ name: `Instalação ${sector.id}`, description: "Instalação", categoryId: category.id, sectorId: sector.id }, prisma);
  const kind = await createServiceField(
    service.id,
    { label: "Equipamento", helpText: null, type: "SELECT", isRequired: true, options: ["Notebook", "Desktop"], minValue: null, maxValue: null },
    prisma,
  );
  return { admin, rita, ana, service, kind };
}

async function start(ana: Actor, requestId: string) {
  actAs(ana);
  await assumeRequest({ requestId }, prisma);
  await transitionRequestStatus({ requestId, toStatus: "IN_PROGRESS" }, prisma);
}

const copied = (requestId: string) =>
  prisma.requestChecklistItem.findMany({
    where: { requestId },
    orderBy: { position: "asc" },
    select: { textSnapshot: true, isRequired: true, position: true, doneAt: true },
  });

describe("the checklist's copy on the first start (4.3 item 2; decision I5)", () => {
  it("copies the active items at that moment, with the conditional ones whose condition the answers meet", async () => {
    const { admin, rita, ana, service, kind } = await scenario();
    actAs(admin);
    await createChecklistItem(service.id, { text: "Instalar", isRequired: true });
    const old = await createChecklistItem(service.id, { text: "Antigo", isRequired: true });
    await setChecklistItemActive(old.id, false);
    const laptop = await createChecklistItem(service.id, { text: "Conferir bateria", isRequired: false });
    // The condition's form comes in SF-224; here it is set straight in the database.
    await prisma.serviceChecklistItem.update({ where: { id: laptop.id }, data: { conditionFieldId: kind.id, conditionValue: "Notebook" } });
    await createChecklistItem(service.id, { text: "Avisar", isRequired: false });

    actAs(rita);
    const notebook = await createRequest({ serviceId: service.id, description: "Novo notebook", fieldValues: { [kind.id]: "Notebook" } }, prisma);
    const desktop = await createRequest({ serviceId: service.id, description: "Novo desktop", fieldValues: { [kind.id]: "Desktop" } }, prisma);
    // Nothing is copied at the opening.
    expect(await prisma.requestChecklist.count({ where: { requestId: { in: [notebook.id, desktop.id] } } })).toBe(0);

    await start(ana, notebook.id);
    await start(ana, desktop.id);

    expect(await copied(notebook.id)).toEqual([
      { textSnapshot: "Instalar", isRequired: true, position: 1, doneAt: null },
      { textSnapshot: "Conferir bateria", isRequired: false, position: 2, doneAt: null },
      { textSnapshot: "Avisar", isRequired: false, position: 3, doneAt: null },
    ]);
    expect((await copied(desktop.id)).map(({ textSnapshot }) => textSnapshot)).toEqual(["Instalar", "Avisar"]);
  });

  it("does not copy again when the request is reopened and started again, even after the model changed", async () => {
    const { admin, rita, ana, service, kind } = await scenario();
    actAs(admin);
    const install = await createChecklistItem(service.id, { text: "Instalar", isRequired: true });
    actAs(rita);
    const request = await createRequest({ serviceId: service.id, description: "Notebook", fieldValues: { [kind.id]: "Notebook" } }, prisma);
    await start(ana, request.id);
    const copiedAt = (await prisma.requestChecklist.findUniqueOrThrow({ where: { requestId: request.id } })).copiedAt;

    // Marked straight in the database (the marking comes in SF-203), so the completion goes on.
    await prisma.requestChecklistItem.updateMany({ where: { requestId: request.id }, data: { doneAt: new Date(), doneById: ana.id } });
    await transitionRequestStatus({ requestId: request.id, toStatus: "COMPLETED" }, prisma);
    actAs(admin);
    await updateChecklistItem(install.id, { text: "Instalar e testar", isRequired: true });
    await createChecklistItem(service.id, { text: "Novo item", isRequired: true });
    actAs(rita);
    await reopenRequest({ requestId: request.id, note: "Voltou a falhar" }, prisma);
    actAs(ana);
    await transitionRequestStatus({ requestId: request.id, toStatus: "IN_PROGRESS" }, prisma);

    expect((await copied(request.id)).map(({ textSnapshot }) => textSnapshot)).toEqual(["Instalar"]);
    expect((await prisma.requestChecklist.findUniqueOrThrow({ where: { requestId: request.id } })).copiedAt).toEqual(copiedAt);
  });

  it("a service without a model: the request is marked as copied, without items, and goes on as before (CA-CHK-01)", async () => {
    const { rita, ana, service, kind } = await scenario();
    actAs(rita);
    const request = await createRequest({ serviceId: service.id, description: "Sem checklist", fieldValues: { [kind.id]: "Desktop" } }, prisma);
    await start(ana, request.id);

    expect(await prisma.requestChecklist.count({ where: { requestId: request.id } })).toBe(1);
    expect(await copied(request.id)).toEqual([]);
    await transitionRequestStatus({ requestId: request.id, toStatus: "COMPLETED" }, prisma);
    await expect(prisma.request.findUniqueOrThrow({ where: { id: request.id } })).resolves.toMatchObject({ status: "COMPLETED" });
  });
});
