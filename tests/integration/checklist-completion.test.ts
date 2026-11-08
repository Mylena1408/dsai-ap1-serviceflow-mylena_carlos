import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { ConflictError } from "@/server/errors";
import { createDomainCategory, createDomainSector, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { ChecklistPendingError, createChecklistItem, markChecklistItem } from "@/modules/checklists";
import { createService } from "@/modules/services";
import { assumeRequest, createRequest, transitionRequestStatus } from "@/modules/requests";

// SPEC 2026-11-08-atendimento-dia-a-dia, 4.3 items 4 and 5 (SF-204; CA-CHK-04 and CA-CHK-01).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });

async function startedRequest(items: Array<{ text: string; isRequired: boolean }>) {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const admin = await createDomainUser({ role: "ADMIN" });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  actAs(admin);
  const service = await createService({ name: `Instalação ${sector.id}`, description: "Instalação", categoryId: category.id, sectorId: sector.id }, prisma);
  for (const item of items) await createChecklistItem(service.id, item);
  actAs(rita);
  const request = await createRequest({ serviceId: service.id, description: "Notebook", fieldValues: {} }, prisma);
  actAs(ana);
  await assumeRequest({ requestId: request.id }, prisma);
  await transitionRequestStatus({ requestId: request.id, toStatus: "IN_PROGRESS" }, prisma);
  const copied = await prisma.requestChecklistItem.findMany({ where: { requestId: request.id }, orderBy: { position: "asc" } });
  return { request, copied };
}

const statusOf = async (id: string) => (await prisma.request.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

describe("the completion and the checklist (4.3 item 4; decision I8)", () => {
  it("is refused with the required items still to mark, in order, and nothing changes", async () => {
    const { request, copied } = await startedRequest([
      { text: "Instalar", isRequired: true },
      { text: "Avisar", isRequired: false },
      { text: "Testar", isRequired: true },
    ]);

    const refusal = await transitionRequestStatus({ requestId: request.id, toStatus: "COMPLETED" }, prisma).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(ChecklistPendingError);
    expect(refusal).toBeInstanceOf(ConflictError);
    expect((refusal as ChecklistPendingError).pendingItems).toEqual(["Instalar", "Testar"]);
    expect(await statusOf(request.id)).toBe("IN_PROGRESS");
    expect(await prisma.requestStatusEvent.count({ where: { requestId: request.id, toStatus: "COMPLETED" } })).toBe(0);

    await markChecklistItem({ requestId: request.id, itemId: copied[0].id, done: true });
    await expect(transitionRequestStatus({ requestId: request.id, toStatus: "COMPLETED" }, prisma)).rejects.toMatchObject({ pendingItems: ["Testar"] });

    // The optional item may stay unmarked.
    await markChecklistItem({ requestId: request.id, itemId: copied[2].id, done: true });
    await transitionRequestStatus({ requestId: request.id, toStatus: "COMPLETED" }, prisma);
    expect(await statusOf(request.id)).toBe("COMPLETED");
  });

  it("only optional items, or no checklist at all: the completion goes on as before (4.3 item 5)", async () => {
    const optional = await startedRequest([{ text: "Avisar", isRequired: false }]);
    await transitionRequestStatus({ requestId: optional.request.id, toStatus: "COMPLETED" }, prisma);
    expect(await statusOf(optional.request.id)).toBe("COMPLETED");

    const none = await startedRequest([]);
    await transitionRequestStatus({ requestId: none.request.id, toStatus: "COMPLETED" }, prisma);
    expect(await statusOf(none.request.id)).toBe("COMPLETED");
  });
});
