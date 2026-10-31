import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import {
  AuthenticationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/server/errors";
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

import { addComment, countComments, listComments } from "@/modules/comments";

// SPEC 2026-10-31-comentarios (SF-054 and SF-055).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };

function actAs(actor: Actor | null) {
  session.getCurrentUser.mockResolvedValue(actor && { ...actor, email: `${actor.id}@example.test` });
}

async function scenario() {
  const sector = await createDomainSector();
  const otherSector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const owner = await createDomainUser({ role: "REQUESTER" });
  const stranger = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const caio = await createDomainUser({ role: "ATTENDANT", sectorId: otherSector.id });
  const admin = await createDomainUser({ role: "ADMIN" });
  const request = await createDomainRequest({ requesterId: owner.id, serviceId: service.id, sectorId: sector.id });
  return { otherSector, owner, stranger, ana, caio, admin, request };
}

describe("request comments (SF-054, SF-055)", () => {
  it("records a conversation in chronological order with the database time (CA-COM-01, 02)", async () => {
    const { owner, ana, request } = await scenario();

    actAs(owner);
    await addComment({ requestId: request.id, body: "  Qual o prazo?  " }, prisma);
    actAs(ana);
    await addComment({ requestId: request.id, body: "Até sexta." }, prisma);

    const conversation = await listComments(request.id, prisma);
    expect(conversation.map(({ body, author }) => [body, author.id])).toEqual([
      ["Qual o prazo?", owner.id],
      ["Até sexta.", ana.id],
    ]);
    expect(conversation[0].createdAt.getTime()).toBeLessThanOrEqual(conversation[1].createdAt.getTime());
  });

  it("rejects invalid text and comments on cancelled requests without writing (CA-COM-03, 04)", async () => {
    const { owner, request } = await scenario();
    actAs(owner);

    await expect(addComment({ requestId: request.id, body: " " }, prisma)).rejects.toBeInstanceOf(ValidationError);
    await expect(
      addComment({ requestId: request.id, body: "a".repeat(5_001) }, prisma),
    ).rejects.toBeInstanceOf(ValidationError);

    await prisma.request.update({ where: { id: request.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    await expect(addComment({ requestId: request.id, body: "Oi" }, prisma)).rejects.toBeInstanceOf(ConflictError);
    await expect(prisma.requestComment.count()).resolves.toBe(0);
    await expect(listComments(request.id, prisma)).resolves.toEqual([]);
  });

  it("keeps internal notes away from the requester in lists and counts (CA-COM-05)", async () => {
    const { owner, ana, request } = await scenario();
    actAs(ana);
    await addComment({ requestId: request.id, body: "Resposta pública" }, prisma);
    await addComment({ requestId: request.id, body: "Só a equipe", isInternal: true }, prisma);

    await expect(listComments(request.id, prisma)).resolves.toHaveLength(2);
    await expect(countComments([request.id], prisma)).resolves.toEqual(new Map([[request.id, 2]]));

    actAs(owner);
    const visible = await listComments(request.id, prisma);
    expect(visible.map(({ body }) => body)).toEqual(["Resposta pública"]);
    expect(JSON.stringify(visible)).not.toContain("Só a equipe");
    await expect(countComments([request.id], prisma)).resolves.toEqual(new Map([[request.id, 1]]));
    await expect(
      addComment({ requestId: request.id, body: "x", isInternal: true }, prisma),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("denies everyone else without revealing the request (CA-COM-06)", async () => {
    const { stranger, caio, admin, ana, otherSector, request } = await scenario();

    for (const actor of [stranger, caio, admin]) {
      actAs(actor);
      await expect(addComment({ requestId: request.id, body: "x" }, prisma)).rejects.toBeInstanceOf(NotFoundError);
      await expect(listComments(request.id, prisma)).rejects.toBeInstanceOf(NotFoundError);
    }
    actAs(null);
    await expect(listComments(request.id, prisma)).rejects.toBeInstanceOf(AuthenticationError);

    // An attendant who moved to another sector loses access immediately.
    await prisma.user.update({ where: { id: ana.id }, data: { sectorId: otherSector.id } });
    actAs({ ...ana, sectorId: otherSector.id });
    await expect(listComments(request.id, prisma)).rejects.toBeInstanceOf(NotFoundError);
    await expect(prisma.requestComment.count()).resolves.toBe(0);
  });

  it("stores markup as plain text (CA-COM-08)", async () => {
    const { owner, request } = await scenario();
    actAs(owner);

    await addComment({ requestId: request.id, body: "<img src=x onerror=alert(1)>" }, prisma);

    await expect(listComments(request.id, prisma)).resolves.toEqual([
      expect.objectContaining({ body: "<img src=x onerror=alert(1)>" }),
    ]);
  });
});
