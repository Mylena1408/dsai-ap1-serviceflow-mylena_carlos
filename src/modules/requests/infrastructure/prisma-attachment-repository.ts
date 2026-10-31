import type { Prisma, PrismaClient } from "@prisma/client";
import type { RequestAttachmentSummary, StoredRequestAttachment } from "../domain/attachment";
import type { AttachmentQueryRepository } from "../application/ports";

// The storage key is selected only for the download lookup, never for listings.
const summary = {
  id: true,
  requirementNameSnapshot: true,
  requirementRequiredSnapshot: true,
  originalFilename: true,
  detectedFormat: true,
  sizeBytes: true,
  createdAt: true,
} satisfies Prisma.RequestAttachmentSelect;

const stored = {
  ...summary,
  contentType: true,
  sha256: true,
  storageKey: true,
} satisfies Prisma.RequestAttachmentSelect;

// Compile-time checks that the selected rows match the domain types.
const toSummary = (
  row: Prisma.RequestAttachmentGetPayload<{ select: typeof summary }>,
): RequestAttachmentSummary => row;
const toStored = (
  row: Prisma.RequestAttachmentGetPayload<{ select: typeof stored }>,
): StoredRequestAttachment => row;

export function createPrismaAttachmentQueryRepository(
  database: PrismaClient,
): AttachmentQueryRepository {
  return {
    findRequestScope(requestId) {
      return database.request.findUnique({
        where: { id: requestId },
        select: { requesterId: true, sectorId: true },
      });
    },
    async listForRequest(requestId) {
      const rows = await database.requestAttachment.findMany({
        where: { requestId },
        select: summary,
        orderBy: [{ createdAt: "asc" }, { requirementNameSnapshot: "asc" }, { id: "asc" }],
      });
      return rows.map(toSummary);
    },
    async findInRequest(requestId, attachmentId) {
      const row = await database.requestAttachment.findFirst({
        where: { id: attachmentId, requestId },
        select: stored,
      });
      return row && toStored(row);
    },
  };
}
