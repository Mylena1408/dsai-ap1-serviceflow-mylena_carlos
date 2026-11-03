import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import type {
  CommentFileStorage,
  CommentRecord,
  CommentRepository,
  CommentTransactionRunner,
  NewCommentFile,
} from "@/modules/comments/application/ports";
import type { CommentRequestScope } from "@/modules/comments/domain/comment-policy";
import { minimalPdf, syntheticText, windowsExecutable } from "../attachments/synthetic-files";

const authorization = vi.hoisted(() => ({ requireCurrentActor: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import { addComment, getCommentFileDownload } from "@/modules/comments/application/comment-use-cases";

// SPEC 2026-11-03-anexos-comentarios-documentos, 5.1 and 5.2 (SF-125; CA-ANX-02 to 04 and 07).

const requestId = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-11-03T12:00:00.000Z");
const people = {
  rita: { id: "rita", name: "Rita", role: "REQUESTER" as const, isActive: true, sectorId: null },
  ana: { id: "ana", name: "Ana", role: "ATTENDANT" as const, isActive: true, sectorId: "sector-1" },
};

function world(status: CommentRequestScope["status"] = "OPEN", existingFiles = 0) {
  const comments: CommentRecord[] = [];
  const files: NewCommentFile[] = [];
  const objects = new Map<string, Uint8Array>();
  let failInsert = false;
  const scope = {
    async findReader(id: string) {
      const person = people[id as keyof typeof people];
      return person ? { id: person.id, role: person.role, isActive: person.isActive, sectorId: person.sectorId } : null;
    },
    async findRequestScope(id: string) {
      return id === requestId ? { requesterId: "rita", sectorId: "sector-1", status } : null;
    },
  };
  const transactions: CommentTransactionRunner = {
    async run(work) {
      const before = { comments: comments.length, files: files.length };
      try {
        return await work({
          ...scope,
          async currentTime() {
            return now;
          },
          async recordEvent() {},
          async countFiles() {
            return existingFiles + files.length;
          },
          async insertFiles(rows) {
            if (failInsert) throw new Error("database down");
            files.push(...rows);
          },
          async insertComment(comment) {
            const author = people[comment.authorId as keyof typeof people];
            const record: CommentRecord = {
              id: comment.id ?? "generated",
              requestId: comment.requestId,
              body: comment.body,
              isInternal: comment.isInternal,
              createdAt: comment.createdAt,
              author: { id: author.id, name: author.name, role: author.role },
            };
            comments.push(record);
            return record;
          },
        });
      } catch (error) {
        comments.length = before.comments;
        files.length = before.files;
        throw error;
      }
    },
  };
  const storage: CommentFileStorage = {
    async put(key, bytes) {
      objects.set(key, bytes);
    },
    async get(key) {
      const bytes = objects.get(key);
      if (!bytes) throw new Error("missing");
      return bytes;
    },
    async remove(key) {
      objects.delete(key);
    },
  };
  const repository: CommentRepository = {
    ...scope,
    async listForRequest() {
      return comments;
    },
    async countForRequests() {
      return new Map();
    },
    async findFile(request, commentId, fileId) {
      const file = files.find((row) => row.id === fileId && row.commentId === commentId && row.requestId === request);
      const comment = comments.find(({ id }) => id === commentId);
      return file && comment
        ? { storageKey: file.storageKey, originalFilename: file.originalFilename, contentType: file.contentType, isInternal: comment.isInternal, removed: false }
        : null;
    },
  };
  return { comments, files, objects, transactions, storage, repository, failInserts: () => (failInsert = true) };
}

const actAs = (person: keyof typeof people) => authorization.requireCurrentActor.mockResolvedValue(people[person]);

describe("comment files (5.1)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stores the files with the comment, with server-derived metadata (CA-ANX-02)", async () => {
    const w = world();
    actAs("rita");

    const comment = await addComment(
      { requestId, body: "Segue o laudo", files: [{ name: "laudo.pdf", bytes: minimalPdf() }, { name: "nota.txt", bytes: syntheticText() }] },
      w.transactions,
      w.storage,
    );

    expect(comment.files?.map(({ originalFilename, detectedFormat }) => [originalFilename, detectedFormat])).toEqual([
      ["laudo.pdf", "PDF"],
      ["nota.txt", "TXT"],
    ]);
    expect(w.files).toHaveLength(2);
    expect(w.files.every((file) => file.commentId === comment.id && file.uploadedById === "rita" && file.createdAt === now)).toBe(true);
    expect(w.files.every((file) => file.storageKey === `requests/${requestId}/${file.id}`)).toBe(true);
    expect([...w.objects.keys()].sort()).toEqual(w.files.map(({ storageKey }) => storageKey).sort());
  });

  it("refuses wrong files before storing anything (CA-ANX-03)", async () => {
    actAs("rita");
    const refusals: Array<[unknown, ReturnType<typeof world>]> = [
      [{ files: Array.from({ length: 4 }, (_, index) => ({ name: `a${index}.txt`, bytes: syntheticText() })) }, world()],
      [{ files: [{ name: "foto.pdf", bytes: windowsExecutable() }] }, world()],
      [{ files: [{ name: "a.txt", bytes: syntheticText() }] }, world("OPEN", 30)],
    ];
    for (const [extra, w] of refusals) {
      await expect(addComment({ requestId, body: "Oi", ...(extra as object) }, w.transactions, w.storage)).rejects.toThrow(ValidationError);
      expect(w.objects.size).toBe(0);
      expect(w.comments).toHaveLength(0);
    }

    const cancelled = world("CANCELLED");
    await expect(
      addComment({ requestId, body: "Oi", files: [{ name: "a.txt", bytes: syntheticText() }] }, cancelled.transactions, cancelled.storage),
    ).rejects.toThrow(ConflictError);
    expect(cancelled.objects.size).toBe(0);
  });

  it("removes the stored objects when the database fails (CA-ANX-07)", async () => {
    const w = world();
    actAs("ana");
    w.failInserts();

    await expect(
      addComment({ requestId, body: "Segue", files: [{ name: "laudo.pdf", bytes: minimalPdf() }] }, w.transactions, w.storage),
    ).rejects.toThrow("database down");

    expect(w.objects.size).toBe(0);
    expect(w.comments).toHaveLength(0);
  });
});

describe("downloading a comment file (5.2)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("gives the file to whoever reads the comment, and hides internal notes from the requester (CA-ANX-04)", async () => {
    const w = world();
    actAs("ana");
    const pdf = minimalPdf();
    const note = await addComment({ requestId, body: "Laudo interno", isInternal: true, files: [{ name: "laudo.pdf", bytes: pdf }] }, w.transactions, w.storage);
    const fileId = note.files![0]!.id;
    const ids = { requestId, commentId: note.id, fileId };

    await expect(getCommentFileDownload(ids, w.repository, w.storage)).resolves.toEqual({
      bytes: pdf,
      contentType: "application/pdf",
      filename: "laudo.pdf",
    });

    actAs("rita");
    await expect(getCommentFileDownload(ids, w.repository, w.storage)).rejects.toThrow(NotFoundError);
    await expect(getCommentFileDownload({ ...ids, fileId: "33333333-3333-4333-8333-333333333333" }, w.repository, w.storage)).rejects.toThrow(NotFoundError);
    await expect(getCommentFileDownload({ ...ids, fileId: "nao-e-id" }, w.repository, w.storage)).rejects.toThrow(ValidationError);
  });
});
