import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";
import { requestShortCode } from "@/shared/requests";

// SPEC 2026-11-07-operacao-e-automacao, 3.3 item 1 and 3.4 (SF-175; CA-VNC-01, 02, 03 and 07 below the
// screens).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { getAttendantRequest, linkRequests, listRequestLinks, unlinkRequests } from "@/modules/requests";

type Actor = { id: string; name: string; email: string; role: Role; sectorId: string | null };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, isActive: true });

async function scenario() {
  const sector = await createDomainSector();
  const other = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const foreign = await createDomainService({ categoryId: category.id, sectorId: other.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const rui = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const caio = await createDomainUser({ role: "ATTENDANT", sectorId: other.id });
  const open = (requesterId = rita.id, serviceId = service.id, sectorId = sector.id) => createDomainRequest({ requesterId, serviceId, sectorId });
  return { sector, other, service, foreign, rita, rui, ana, caio, open };
}

const code = (id: string) => requestShortCode(id);

describe("link schema (3.4; CA-VNC-07)", () => {
  it("refuses a link to itself, a second link of a pair and a second original", async () => {
    const { ana, open } = await scenario();
    const [a, b, c] = [await open(), await open(), await open()];
    const base = { createdById: ana.id, createdAt: new Date() };

    await expect(prisma.requestLink.create({ data: { ...base, fromRequestId: a.id, toRequestId: a.id, kind: "RELATED" } })).rejects.toThrow(/RequestLink_not_self_check/);
    await prisma.requestLink.create({ data: { ...base, fromRequestId: a.id, toRequestId: b.id, kind: "RELATED" } });
    await expect(prisma.requestLink.create({ data: { ...base, fromRequestId: b.id, toRequestId: a.id, kind: "DUPLICATE_OF" } })).rejects.toThrow(
      /RequestLink_pair_key|Unique constraint/,
    );
    await prisma.requestLink.create({ data: { ...base, fromRequestId: c.id, toRequestId: a.id, kind: "DUPLICATE_OF" } });
    await expect(prisma.requestLink.create({ data: { ...base, fromRequestId: c.id, toRequestId: b.id, kind: "DUPLICATE_OF" } })).rejects.toThrow(
      /RequestLink_one_original_key|Unique constraint/,
    );
    await expect(
      prisma.requestLinkEvent.create({ data: { fromRequestId: a.id, toRequestId: a.id, kind: "RELATED", action: "LINKED", actorId: ana.id, occurredAt: new Date() } }),
    ).rejects.toThrow(/RequestLinkEvent_not_self_check/);
  });
});

describe("linking requests (3.3 item 1; CA-VNC-02)", () => {
  it("links by the short code, in both histories, without changing the status", async () => {
    const { ana, open } = await scenario();
    const [duplicate, original, related] = [await open(), await open(), await open()];
    actAs(ana);

    await linkRequests({ requestId: duplicate.id, code: `#${code(original.id).toLowerCase()}`, kind: "DUPLICATE_OF" }, prisma);
    await linkRequests({ requestId: original.id, code: code(related.id), kind: "RELATED" }, prisma);

    expect((await prisma.request.findUniqueOrThrow({ where: { id: duplicate.id } })).status).toBe("OPEN");
    const fromDuplicate = await listRequestLinks(duplicate.id, prisma);
    expect(fromDuplicate.links).toEqual([{ id: expect.any(String), role: "duplicate_of", other: expect.objectContaining({ id: original.id, readable: true }) }]);
    const fromOriginal = await listRequestLinks(original.id, prisma);
    expect(fromOriginal.links.map(({ role, other }) => [role, other.id])).toEqual([
      ["original_of", duplicate.id],
      ["related", related.id],
    ]);
    expect(fromOriginal.events.map(({ role, action, actor }) => [role, action, actor.id])).toEqual([
      ["original_of", "LINKED", ana.id],
      ["related", "LINKED", ana.id],
    ]);
    // The request itself keeps its own history as before.
    expect((await getAttendantRequest(duplicate.id, prisma)).status).toBe("OPEN");
  });

  it("refuses itself, a repeated pair, chains, more than 10 and unknown or unreadable codes", async () => {
    const { ana, rita, foreign, other, open } = await scenario();
    const [a, b, c] = [await open(), await open(), await open()];
    actAs(ana);

    await expect(linkRequests({ requestId: a.id, code: code(a.id), kind: "RELATED" }, prisma)).rejects.toBeInstanceOf(ValidationError);
    await linkRequests({ requestId: a.id, code: code(b.id), kind: "DUPLICATE_OF" }, prisma);
    await expect(linkRequests({ requestId: b.id, code: code(a.id), kind: "RELATED" }, prisma)).rejects.toBeInstanceOf(ConflictError);
    // a is a duplicate: it cannot be an original, nor a duplicate again.
    await expect(linkRequests({ requestId: c.id, code: code(a.id), kind: "DUPLICATE_OF" }, prisma)).rejects.toBeInstanceOf(ConflictError);
    await expect(linkRequests({ requestId: a.id, code: code(c.id), kind: "DUPLICATE_OF" }, prisma)).rejects.toBeInstanceOf(ConflictError);
    // b is an original: it cannot become a duplicate.
    await expect(linkRequests({ requestId: b.id, code: code(c.id), kind: "DUPLICATE_OF" }, prisma)).rejects.toBeInstanceOf(ConflictError);

    const many = [];
    for (let index = 0; index < 9; index += 1) many.push(await open());
    for (const item of many) await linkRequests({ requestId: b.id, code: code(item.id), kind: "RELATED" }, prisma);
    await expect(linkRequests({ requestId: b.id, code: code(c.id), kind: "RELATED" }, prisma)).rejects.toBeInstanceOf(ConflictError);
    await expect(linkRequests({ requestId: c.id, code: code(b.id), kind: "RELATED" }, prisma)).rejects.toBeInstanceOf(ConflictError);

    // Another sector's request is not found for this attendant; an unknown code neither.
    const outside = await open(rita.id, foreign.id, other.id);
    await expect(linkRequests({ requestId: c.id, code: code(outside.id), kind: "RELATED" }, prisma)).rejects.toBeInstanceOf(NotFoundError);
    const unknown = code(outside.id) === "FFFFFFFF" ? "EEEEEEEE" : "FFFFFFFF";
    await expect(linkRequests({ requestId: c.id, code: unknown, kind: "RELATED" }, prisma)).rejects.toBeInstanceOf(NotFoundError);
    await expect(prisma.requestLink.count()).resolves.toBe(10);
  });

  it("refuses an ambiguous code and anyone who is not an attendant of the request's sector", async () => {
    const { ana, caio, rita, open } = await scenario();
    const [a, b, c] = [await open(), await open(), await open()];
    // Two requests whose ids start with the same 8 digits.
    const prefix = "abcdef12";
    await prisma.request.update({ where: { id: b.id }, data: { id: `${prefix}-0000-4000-8000-${b.id.slice(-12)}` } });
    await prisma.request.update({ where: { id: c.id }, data: { id: `${prefix}-ffff-4000-8000-${c.id.slice(-12)}` } });

    actAs(ana);
    await expect(linkRequests({ requestId: a.id, code: prefix, kind: "RELATED" }, prisma)).rejects.toBeInstanceOf(ValidationError);
    actAs(caio);
    await expect(linkRequests({ requestId: a.id, code: prefix, kind: "RELATED" }, prisma)).rejects.toThrow();
    actAs({ ...rita, role: "REQUESTER" });
    await expect(linkRequests({ requestId: a.id, code: prefix, kind: "RELATED" }, prisma)).rejects.toThrow();
    await expect(prisma.requestLink.count()).resolves.toBe(0);
  });

  it("two links of the same pair at once keep one", async () => {
    const { ana, open } = await scenario();
    const [a, b] = [await open(), await open()];
    actAs(ana);
    const results = await Promise.allSettled([
      linkRequests({ requestId: a.id, code: code(b.id), kind: "RELATED" }, prisma),
      linkRequests({ requestId: b.id, code: code(a.id), kind: "DUPLICATE_OF" }, prisma),
      linkRequests({ requestId: a.id, code: code(b.id), kind: "RELATED" }, prisma),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    await expect(prisma.requestLink.count()).resolves.toBe(1);
    await expect(prisma.requestLinkEvent.count()).resolves.toBe(1);
  });

  it("removes from either side, with the history", async () => {
    const { ana, open } = await scenario();
    const [a, b] = [await open(), await open()];
    actAs(ana);
    const { linkId } = await linkRequests({ requestId: a.id, code: code(b.id), kind: "DUPLICATE_OF" }, prisma);
    await unlinkRequests({ requestId: b.id, linkId }, prisma);
    await expect(unlinkRequests({ requestId: b.id, linkId }, prisma)).rejects.toBeInstanceOf(NotFoundError);

    expect((await listRequestLinks(a.id, prisma)).links).toEqual([]);
    expect((await listRequestLinks(a.id, prisma)).events.map(({ role, action }) => [role, action])).toEqual([
      ["duplicate_of", "LINKED"],
      ["duplicate_of", "UNLINKED"],
    ]);
  });
});

describe("who sees the links (3.3 item 1; CA-VNC-01 and 03)", () => {
  it("the requester sees links between their own requests only; a request without links has none", async () => {
    const { ana, rita, rui, open } = await scenario();
    const [mine, alsoMine, theirs, alone] = [await open(), await open(), await open(rui.id), await open()];
    actAs(ana);
    await linkRequests({ requestId: mine.id, code: code(alsoMine.id), kind: "RELATED" }, prisma);
    await linkRequests({ requestId: mine.id, code: code(theirs.id), kind: "RELATED" }, prisma);

    actAs({ ...rita, role: "REQUESTER" });
    const view = await listRequestLinks(mine.id, prisma);
    expect(view.links.map(({ other }) => other.id)).toEqual([alsoMine.id]);
    expect(view.events).toHaveLength(1);
    expect(await listRequestLinks(alone.id, prisma)).toEqual({ links: [], events: [] });
    // Someone else's request stays hidden as before.
    actAs({ ...rui, role: "REQUESTER" });
    await expect(listRequestLinks(mine.id, prisma)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("after a request moves to another sector, the attendant sees the link but cannot open it", async () => {
    const { ana, other, open } = await scenario();
    const [a, b] = [await open(), await open()];
    actAs(ana);
    await linkRequests({ requestId: a.id, code: code(b.id), kind: "RELATED" }, prisma);
    await prisma.request.update({ where: { id: b.id }, data: { sectorId: other.id } });

    const view = await listRequestLinks(a.id, prisma);
    expect(view.links).toEqual([{ id: expect.any(String), role: "related", other: expect.objectContaining({ id: b.id, sectorName: other.name, readable: false }) }]);
  });
});
