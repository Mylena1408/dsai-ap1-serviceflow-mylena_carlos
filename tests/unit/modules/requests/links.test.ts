import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import {
  assertCanLink,
  codeRange,
  linkInputSchema,
  linkRole,
  linkVisibleToRequester,
  otherRequestId,
  requestCodeSchema,
  type LinkRecord,
} from "@/modules/requests/domain/links";
import type { LinkRequestState, LinkTransaction } from "@/modules/requests/application/links";

const authorization = vi.hoisted(() => ({ actor: null as unknown }));
vi.mock("@/server/authorization", async () => {
  const policy = await import("@/server/authorization/policy");
  return {
    assertRequestReadable: policy.assertRequestReadable,
    assertStatusChangeAllowed: policy.assertStatusChangeAllowed,
    requireCurrentActor: vi.fn(async () => authorization.actor),
    actorHasPermission: vi.fn(async () => false),
  };
});

import { linkRequests, listRequestLinks, unlinkRequests } from "@/modules/requests/application/links";

// SPEC 2026-11-07-operacao-e-automacao, 3.3 item 1 (SF-175; CA-VNC-02 and 03 by the rules).

const A = "aaaaaaaa-1111-4111-8111-111111111111";
const B = "bbbbbbbb-2222-4222-8222-222222222222";
const C = "cccccccc-3333-4333-8333-333333333333";
const link = (id: string, from: string, to: string, kind: LinkRecord["kind"] = "RELATED"): LinkRecord => ({ id, fromRequestId: from, toRequestId: to, kind });

describe("short codes", () => {
  it("accepts the 8 digits the screens show, with or without '#', in any case", () => {
    expect(requestCodeSchema.parse(" #aaaaaaaa ")).toBe("AAAAAAAA");
    expect(requestCodeSchema.parse("BBBBBBBB")).toBe("BBBBBBBB");
    for (const code of ["", "AAAA", "AAAAAAAAA", "GGGGGGGG", "aaaa-aaa"]) expect(requestCodeSchema.safeParse(code).success).toBe(false);
    expect(linkInputSchema.safeParse({ requestId: A, code: "BBBBBBBB", kind: "OTHER" }).success).toBe(false);
  });

  it("turns a code into the id range of the primary key", () => {
    expect(codeRange("AAAAAAAA")).toEqual({ from: "aaaaaaaa-0000-0000-0000-000000000000", to: "aaaaaaaa-ffff-ffff-ffff-ffffffffffff" });
  });
});

describe("link rules (3.3 item 1)", () => {
  it("refuses itself and a second link of the same pair, in either direction or kind", () => {
    expect(() => assertCanLink(A, A, "RELATED", [], [])).toThrow(ValidationError);
    expect(() => assertCanLink(A, B, "RELATED", [link("1", B, A)], [link("1", B, A)])).toThrow(ConflictError);
    expect(() => assertCanLink(A, B, "DUPLICATE_OF", [link("1", A, B)], [link("1", A, B)])).toThrow(ConflictError);
    expect(() => assertCanLink(A, B, "RELATED", [], [])).not.toThrow();
  });

  it("allows up to 10 links on each side", () => {
    const many = (id: string) => Array.from({ length: 10 }, (_, index) => link(`${index}`, id, `other-${index}`));
    expect(() => assertCanLink(A, B, "RELATED", many(A), [])).toThrow(ConflictError);
    expect(() => assertCanLink(A, B, "RELATED", [], many(B))).toThrow(ConflictError);
    expect(() => assertCanLink(A, B, "RELATED", many(A).slice(1), many(B).slice(1))).not.toThrow();
  });

  it("keeps duplicates without chains", () => {
    // A already duplicates C.
    expect(() => assertCanLink(A, B, "DUPLICATE_OF", [link("1", A, C, "DUPLICATE_OF")], [])).toThrow(ConflictError);
    // C duplicates A: A is an original and cannot become a duplicate.
    expect(() => assertCanLink(A, B, "DUPLICATE_OF", [link("1", C, A, "DUPLICATE_OF")], [])).toThrow(ConflictError);
    // B duplicates C: B cannot be an original.
    expect(() => assertCanLink(A, B, "DUPLICATE_OF", [], [link("1", B, C, "DUPLICATE_OF")])).toThrow(ConflictError);
    // B is the original of C: another duplicate of B is fine, and so is a related link of a duplicate.
    expect(() => assertCanLink(A, B, "DUPLICATE_OF", [], [link("1", C, B, "DUPLICATE_OF")])).not.toThrow();
    expect(() => assertCanLink(A, B, "RELATED", [link("1", A, C, "DUPLICATE_OF")], [])).not.toThrow();
  });

  it("reads a link from either side", () => {
    const dup = link("1", A, B, "DUPLICATE_OF");
    expect(otherRequestId(dup, A)).toBe(B);
    expect(otherRequestId(dup, B)).toBe(A);
    expect(linkRole(dup, A)).toBe("duplicate_of");
    expect(linkRole(dup, B)).toBe("original_of");
    expect(linkRole(link("2", A, B), B)).toBe("related");
    expect(linkVisibleToRequester("rita", "rita")).toBe(true);
    expect(linkVisibleToRequester("rita", "rui")).toBe(false);
  });
});

const ana = { id: "ana", role: "ATTENDANT" as const, isActive: true, sectorId: "s1", name: "Ana", email: "ana@x" };
const state = (id: string, overrides: Partial<LinkRequestState> = {}): LinkRequestState => ({
  id,
  requesterId: "rita",
  sectorId: "s1",
  requiresApproval: false,
  approvalSectorIds: [],
  status: "OPEN",
  serviceName: "Reparo",
  sectorName: "TI",
  ...overrides,
});

function store(requests: LinkRequestState[], links: LinkRecord[] = [], codes: string[] = [B]) {
  const now = new Date("2026-11-07T12:00:00Z");
  const transaction: LinkTransaction = {
    currentTime: vi.fn(async () => now),
    findRequest: vi.fn(async (id) => requests.find((request) => request.id === id) ?? null),
    findByCode: vi.fn(async () => codes),
    linksOf: vi.fn(async (id) => links.filter((item) => item.fromRequestId === id || item.toRequestId === id)),
    insertLink: vi.fn(async () => ({ id: "new-link" })),
    deleteLink: vi.fn(async () => undefined),
    insertEvent: vi.fn(async () => undefined),
  };
  return { transaction, now, runner: { run: <T>(work: (t: LinkTransaction) => Promise<T>) => work(transaction) } };
}

describe("link use cases (3.3 item 1)", () => {
  beforeEach(() => {
    authorization.actor = ana;
  });

  it("links by code and records the history, without touching the status", async () => {
    const { runner, transaction, now } = store([state(A), state(B)]);
    await expect(linkRequests({ requestId: A, code: "#bbbbbbbb", kind: "DUPLICATE_OF" }, runner)).resolves.toEqual({ linkId: "new-link" });
    expect(transaction.findByCode).toHaveBeenCalledWith(codeRange("BBBBBBBB"));
    expect(transaction.insertLink).toHaveBeenCalledWith({ fromRequestId: A, toRequestId: B, kind: "DUPLICATE_OF", createdById: "ana", createdAt: now });
    expect(transaction.insertEvent).toHaveBeenCalledWith({ fromRequestId: A, toRequestId: B, kind: "DUPLICATE_OF", action: "LINKED", actorId: "ana", occurredAt: now });
  });

  it("only an attendant of the request's sector links, and only to a request they can read", async () => {
    await expect(linkRequests({ requestId: A, code: "BBBBBBBB", kind: "RELATED" }, store([state(A, { sectorId: "s2" }), state(B)]).runner)).rejects.toThrow();
    await expect(linkRequests({ requestId: A, code: "BBBBBBBB", kind: "RELATED" }, store([state(A), state(B, { sectorId: "s2" })]).runner)).rejects.toThrow(NotFoundError);
    await expect(linkRequests({ requestId: A, code: "BBBBBBBB", kind: "RELATED" }, store([state(A)], [], []).runner)).rejects.toThrow(NotFoundError);
    await expect(linkRequests({ requestId: A, code: "BBBBBBBB", kind: "RELATED" }, store([state(A), state(B)], [], [B, C]).runner)).rejects.toThrow(ValidationError);
    authorization.actor = { ...ana, role: "REQUESTER", sectorId: null };
    await expect(linkRequests({ requestId: A, code: "BBBBBBBB", kind: "RELATED" }, store([state(A, { requesterId: "ana" }), state(B)]).runner)).rejects.toThrow();
  });

  it("removes from either side with the history", async () => {
    const existing = link("l1", A, B, "DUPLICATE_OF");
    const { runner, transaction } = store([state(A), state(B)], [existing]);
    // An id that is not a uuid is refused before the transaction.
    await expect(unlinkRequests({ requestId: B, linkId: "l1" }, runner)).rejects.toThrow(ValidationError);
    expect(transaction.deleteLink).not.toHaveBeenCalled();

    const valid = "dddddddd-4444-4444-8444-444444444444";
    const second = store([state(A), state(B)], [{ ...existing, id: valid }]);
    await unlinkRequests({ requestId: B, linkId: valid }, second.runner);
    expect(second.transaction.deleteLink).toHaveBeenCalledWith(valid);
    expect(second.transaction.insertEvent).toHaveBeenCalledWith(expect.objectContaining({ fromRequestId: A, toRequestId: B, action: "UNLINKED", kind: "DUPLICATE_OF" }));

    const missing = store([state(A), state(B)], []);
    await expect(unlinkRequests({ requestId: A, linkId: valid }, missing.runner)).rejects.toThrow(NotFoundError);
  });
});

describe("reading the links (3.3 item 1; CA-VNC-03)", () => {
  const scope = {
    findRequestScope: vi.fn(async () => ({ requesterId: "rita", sectorId: "s1", requiresApproval: false, approvalSectorIds: [] })),
  };
  const actor = { id: "x", name: "X" };
  const at = new Date("2026-11-07T12:00:00Z");
  const reader = {
    listLinks: vi.fn(async () => [
      { ...link("l1", A, B), other: state(B, { requesterId: "rita" }) },
      { ...link("l2", C, A, "DUPLICATE_OF"), other: state(C, { requesterId: "rui", sectorId: "s2", sectorName: "RH" }) },
    ]),
    listEvents: vi.fn(async () => [
      { id: "e1", fromRequestId: A, toRequestId: B, kind: "RELATED" as const, action: "LINKED" as const, actor, occurredAt: at, otherRequesterId: "rita" },
      { id: "e2", fromRequestId: C, toRequestId: A, kind: "DUPLICATE_OF" as const, action: "LINKED" as const, actor, occurredAt: at, otherRequesterId: "rui" },
    ]),
  };

  it("the requester sees only links between their own requests", async () => {
    authorization.actor = { id: "rita", role: "REQUESTER", isActive: true, sectorId: null };
    const result = await listRequestLinks(A, scope, reader);
    expect(result.links).toEqual([{ id: "l1", role: "related", other: expect.objectContaining({ id: B, readable: true }) }]);
    expect(result.events.map(({ id }) => id)).toEqual(["e1"]);
  });

  it("the attendant sees every link, opening only what they can read", async () => {
    authorization.actor = ana;
    const result = await listRequestLinks(A, scope, reader);
    expect(result.links).toEqual([
      { id: "l1", role: "related", other: { id: B, serviceName: "Reparo", sectorName: "TI", status: "OPEN", readable: true } },
      { id: "l2", role: "original_of", other: { id: C, serviceName: "Reparo", sectorName: "RH", status: "OPEN", readable: false } },
    ]);
    expect(result.events.map(({ role, otherRequestId: other }) => [role, other])).toEqual([
      ["related", B],
      ["original_of", C],
    ]);
  });
});
