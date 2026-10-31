import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthenticationError,
  InternalServerError,
  NotFoundError,
  ValidationError,
} from "@/server/errors";
import { assertRequestReadable } from "@/server/authorization/policy";
import { sha256Hex } from "@/modules/attachments";
import type { AttachmentQueryRepository } from "@/modules/requests/application/ports";
import type { StoredRequestAttachment } from "@/modules/requests/domain/attachment";
import { minimalPdf } from "../../attachments/synthetic-files";

const authorization = vi.hoisted(() => ({
  requireCurrentActor: vi.fn(),
  assertRequestReadable: vi.fn(),
}));
vi.mock("@/server/authorization", () => authorization);

import {
  getAttachmentDownload,
  listRequestAttachments,
} from "@/modules/requests/application/attachment-queries";

const requestId = "55555555-5555-4555-8555-555555555551";
const otherRequestId = "55555555-5555-4555-8555-555555555552";
const attachmentId = "66666666-6666-4666-8666-666666666661";
const content = minimalPdf();

const attachment: StoredRequestAttachment = {
  id: attachmentId,
  requirementNameSnapshot: "Request form",
  requirementRequiredSnapshot: true,
  originalFilename: "form.pdf",
  detectedFormat: "PDF",
  sizeBytes: content.length,
  createdAt: new Date("2026-10-31T12:00:00.000Z"),
  contentType: "application/pdf",
  sha256: sha256Hex(content),
  storageKey: `requests/${requestId}/${attachmentId}`,
};

const requests = {
  [requestId]: { requesterId: "requester-1", sectorId: "sector-1" },
  [otherRequestId]: { requesterId: "requester-1", sectorId: "sector-1" },
};

function repository(): AttachmentQueryRepository {
  return {
    async findRequestScope(id) {
      return requests[id as keyof typeof requests] ?? null;
    },
    async listForRequest(id) {
      if (id !== requestId) return [];
      return [
        {
          id: attachment.id,
          requirementNameSnapshot: attachment.requirementNameSnapshot,
          requirementRequiredSnapshot: attachment.requirementRequiredSnapshot,
          originalFilename: attachment.originalFilename,
          detectedFormat: attachment.detectedFormat,
          sizeBytes: attachment.sizeBytes,
          createdAt: attachment.createdAt,
        },
      ];
    },
    async findInRequest(id, attachment_id) {
      return id === requestId && attachment_id === attachmentId ? attachment : null;
    },
  };
}

const actors = {
  owner: { id: "requester-1", role: "REQUESTER", sectorId: null, isActive: true },
  otherRequester: { id: "requester-2", role: "REQUESTER", sectorId: null, isActive: true },
  attendant: { id: "attendant-1", role: "ATTENDANT", sectorId: "sector-1", isActive: true },
  otherSector: { id: "attendant-2", role: "ATTENDANT", sectorId: "sector-2", isActive: true },
  admin: { id: "admin-1", role: "ADMIN", sectorId: null, isActive: true },
} as const;

function storage(bytes: Uint8Array = content) {
  return { get: vi.fn(async () => bytes) };
}

describe("attachment queries (SPEC 21.5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorization.assertRequestReadable.mockImplementation(assertRequestReadable);
  });

  it("lets the owner and an attendant of the sector list and download (CA-DOC-14, CA-DOC-15)", async () => {
    for (const actor of [actors.owner, actors.attendant]) {
      authorization.requireCurrentActor.mockResolvedValue(actor);
      const reader = storage();

      const listed = await listRequestAttachments(requestId, repository());
      const download = await getAttachmentDownload(requestId, attachmentId, repository(), reader);

      expect(listed).toEqual([expect.objectContaining({ id: attachmentId, originalFilename: "form.pdf" })]);
      expect(listed[0]).not.toHaveProperty("storageKey");
      expect(download).toEqual({ filename: "form.pdf", contentType: "application/pdf", bytes: content });
      expect(sha256Hex(download.bytes)).toBe(attachment.sha256);
      expect(reader.get).toHaveBeenCalledWith(attachment.storageKey);
    }
  });

  it("denies other requesters, other sectors and administrators as not found (CA-DOC-16)", async () => {
    for (const actor of [actors.otherRequester, actors.otherSector, actors.admin]) {
      authorization.requireCurrentActor.mockResolvedValue(actor);
      const reader = storage();

      await expect(listRequestAttachments(requestId, repository())).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        getAttachmentDownload(requestId, attachmentId, repository(), reader),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(reader.get).not.toHaveBeenCalled();
    }
  });

  it("stops unauthenticated or inactive users before loading anything", async () => {
    authorization.requireCurrentActor.mockRejectedValue(new AuthenticationError());
    const repo = repository();
    const scope = vi.spyOn(repo, "findRequestScope");
    const reader = storage();

    await expect(
      getAttachmentDownload(requestId, attachmentId, repo, reader),
    ).rejects.toBeInstanceOf(AuthenticationError);
    expect(scope).not.toHaveBeenCalled();
    expect(reader.get).not.toHaveBeenCalled();
  });

  it("refuses an attachment that belongs to another request (CA-DOC-17)", async () => {
    authorization.requireCurrentActor.mockResolvedValue(actors.owner);
    const reader = storage();

    await expect(
      getAttachmentDownload(otherRequestId, attachmentId, repository(), reader),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(reader.get).not.toHaveBeenCalled();
  });

  it("rejects malformed identifiers and unknown requests", async () => {
    authorization.requireCurrentActor.mockResolvedValue(actors.owner);

    await expect(
      getAttachmentDownload("not-an-id", attachmentId, repository(), storage()),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      getAttachmentDownload(requestId, "not-an-id", repository(), storage()),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      listRequestAttachments("77777777-7777-4777-8777-777777777777", repository()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("never serves content that differs from the recorded metadata", async () => {
    authorization.requireCurrentActor.mockResolvedValue(actors.owner);
    const truncated = content.slice(0, content.length - 1);
    const altered = new Uint8Array(content);
    altered[altered.length - 1] ^= 0xff;

    for (const bytes of [truncated, altered]) {
      await expect(
        getAttachmentDownload(requestId, attachmentId, repository(), storage(bytes)),
      ).rejects.toBeInstanceOf(InternalServerError);
    }
  });
});
