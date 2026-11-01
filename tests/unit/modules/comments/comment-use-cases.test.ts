import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import type {
  CommentRecord,
  CommentRepository,
  CommentTransactionRunner,
  NewComment,
} from "@/modules/comments/application/ports";
import type { CommentReader, CommentRequestScope } from "@/modules/comments/domain/comment-policy";

const authorization = vi.hoisted(() => ({ requireCurrentActor: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import { addComment, countComments, listComments } from "@/modules/comments/application/comment-use-cases";

// SPEC 2026-10-31-comentarios (SF-054 and SF-055).

const requestId = "55555555-5555-4555-8555-555555555551";
const otherRequestId = "55555555-5555-4555-8555-555555555552";
const databaseTime = new Date("2026-10-31T20:00:00.000Z");

const readers: Record<string, CommentReader & { name: string }> = {
  owner: { id: "owner", name: "Rita", role: "REQUESTER", isActive: true, sectorId: null },
  stranger: { id: "stranger", name: "Outro", role: "REQUESTER", isActive: true, sectorId: null },
  ana: { id: "ana", name: "Ana", role: "ATTENDANT", isActive: true, sectorId: "sector-1" },
  caio: { id: "caio", name: "Caio", role: "ATTENDANT", isActive: true, sectorId: "sector-2" },
  admin: { id: "admin", name: "Admin", role: "ADMIN", isActive: true, sectorId: null },
};

interface Store {
  requests: Record<string, CommentRequestScope>;
  comments: CommentRecord[];
}

function createStore(status: CommentRequestScope["status"] = "OPEN"): Store {
  return {
    requests: {
      [requestId]: { requesterId: "owner", sectorId: "sector-1", status },
      [otherRequestId]: { requesterId: "owner", sectorId: "sector-1", status: "OPEN" },
    },
    comments: [],
  };
}

function scope(store: Store) {
  return {
    async findReader(id: string) {
      const reader = readers[id];
      return reader ? { id: reader.id, role: reader.role, isActive: reader.isActive, sectorId: reader.sectorId } : null;
    },
    async findRequestScope(id: string) {
      return store.requests[id] ?? null;
    },
  };
}

function runner(store: Store): CommentTransactionRunner {
  return {
    async run(work) {
      return work({
        ...scope(store),
        async currentTime() {
          return databaseTime;
        },
        async recordEvent() {},
        async insertComment(comment: NewComment) {
          const author = readers[comment.authorId];
          const record = {
            id: `comment-${store.comments.length + 1}`,
            requestId: comment.requestId,
            body: comment.body,
            isInternal: comment.isInternal,
            createdAt: comment.createdAt,
            author: { id: author.id, name: author.name, role: author.role },
          };
          store.comments.push(record);
          return record;
        },
      });
    },
  };
}

function repository(store: Store): CommentRepository {
  return {
    ...scope(store),
    async listForRequest(id, includeInternal) {
      return store.comments.filter((c) => c.requestId === id && (includeInternal || !c.isInternal));
    },
    async countForRequests(ids, includeInternal) {
      const counts = new Map<string, number>();
      for (const c of store.comments) {
        if (ids.includes(c.requestId) && (includeInternal || !c.isInternal)) {
          counts.set(c.requestId, (counts.get(c.requestId) ?? 0) + 1);
        }
      }
      return counts;
    },
  };
}

const actAs = (name: keyof typeof readers) => authorization.requireCurrentActor.mockResolvedValue(readers[name]);

describe("comment use cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores author, trimmed text and database time for owner and sector attendant (CA-COM-01)", async () => {
    const store = createStore();
    actAs("owner");
    await addComment({ requestId, body: "  Qual o prazo?  " }, runner(store));
    actAs("ana");
    await addComment({ requestId, body: "Até sexta." }, runner(store));

    expect(store.comments).toEqual([
      expect.objectContaining({ body: "Qual o prazo?", isInternal: false, createdAt: databaseTime, author: expect.objectContaining({ id: "owner" }) }),
      expect.objectContaining({ body: "Até sexta.", author: expect.objectContaining({ id: "ana" }) }),
    ]);
  });

  it("rejects empty or too long text before anything else (CA-COM-03)", async () => {
    const store = createStore();
    for (const body of ["", "   ", "a".repeat(5_001)]) {
      await expect(addComment({ requestId, body }, runner(store))).rejects.toBeInstanceOf(ValidationError);
    }
    expect(store.comments).toHaveLength(0);
    expect(authorization.requireCurrentActor).not.toHaveBeenCalled();
  });

  it("keeps cancelled requests read-only (CA-COM-04)", async () => {
    const store = createStore("CANCELLED");
    actAs("owner");
    await expect(addComment({ requestId, body: "Oi" }, runner(store))).rejects.toBeInstanceOf(ConflictError);

    store.comments.push({ id: "old", requestId, body: "Antes", isInternal: false, createdAt: databaseTime, author: { id: "owner", name: "Rita", role: "REQUESTER" } });
    await expect(listComments(requestId, repository(store))).resolves.toHaveLength(1);
  });

  it("lets only attendants write internal notes and hides them from the requester (CA-COM-05)", async () => {
    const store = createStore();
    actAs("owner");
    await expect(addComment({ requestId, body: "x", isInternal: true }, runner(store))).rejects.toBeInstanceOf(
      ValidationError,
    );

    actAs("ana");
    await addComment({ requestId, body: "Pública" }, runner(store));
    await addComment({ requestId, body: "Só a equipe", isInternal: true }, runner(store));

    await expect(listComments(requestId, repository(store))).resolves.toHaveLength(2);
    await expect(countComments([requestId], repository(store))).resolves.toEqual(new Map([[requestId, 2]]));

    actAs("owner");
    const visible = await listComments(requestId, repository(store));
    expect(visible.map(({ body }) => body)).toEqual(["Pública"]);
    await expect(countComments([requestId], repository(store))).resolves.toEqual(new Map([[requestId, 1]]));
  });

  it("hides the request from everyone else (CA-COM-06)", async () => {
    for (const name of ["stranger", "caio", "admin"] as const) {
      const store = createStore();
      actAs(name);
      await expect(addComment({ requestId, body: "x" }, runner(store))).rejects.toBeInstanceOf(NotFoundError);
      await expect(listComments(requestId, repository(store))).rejects.toBeInstanceOf(NotFoundError);
      expect(store.comments).toHaveLength(0);
    }
  });

  it("rejects forged author, time or extra fields (CA-COM-07)", async () => {
    const store = createStore();
    actAs("owner");
    for (const input of [
      { requestId, body: "x", authorId: "ana" },
      { requestId, body: "x", createdAt: "2020-01-01" },
      { requestId: "not-an-id", body: "x" },
    ]) {
      await expect(addComment(input, runner(store))).rejects.toBeInstanceOf(ValidationError);
    }
    expect(store.comments).toHaveLength(0);
  });
});
