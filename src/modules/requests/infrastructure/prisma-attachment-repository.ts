import type { Prisma, PrismaClient } from "@prisma/client";
import type { RequestAttachmentSummary, StoredRequestAttachment } from "../domain/attachment";
import type { AttachmentQueryRepository } from "../application/ports";
import type { RequestExistenceReader } from "../application/orphan-cleanup";

// The storage key is selected only for the download lookup, never for listings.
const summary = {
  id: true,
  requirementNameSnapshot: true,
  requirementRequiredSnapshot: true,
  originalFilename: true,
  detectedFormat: true,
  sizeBytes: true,
  createdAt: true,
  removedAt: true,
} satisfies Prisma.RequestAttachmentSelect;

const stored = {
  ...summary,
  contentType: true,
  sha256: true,
  storageKey: true,
} satisfies Prisma.RequestAttachmentSelect;

// The removal time appears only for a removed file (CA-AUD-01: other listings keep their fields).
function withRemoval<Row extends { removedAt: Date | null }>({ removedAt, ...row }: Row) {
  return removedAt === null ? row : { ...row, removedAt };
}

// Compile-time checks that the selected rows match the domain types.
const toSummary = (
  row: Prisma.RequestAttachmentGetPayload<{ select: typeof summary }>,
): RequestAttachmentSummary => withRemoval(row);
const toStored = (
  row: Prisma.RequestAttachmentGetPayload<{ select: typeof stored }>,
): StoredRequestAttachment => withRemoval(row);

export function createPrismaAttachmentQueryRepository(
  database: PrismaClient,
): AttachmentQueryRepository {
  return {
    async findRequestScope(requestId) {
      const row = await database.request.findUnique({
        where: { id: requestId },
        select: { requesterId: true, sectorId: true, approvalState: true },
      });
      return row && { requesterId: row.requesterId, sectorId: row.sectorId, requiresApproval: row.approvalState !== null };
    },
    async listForRequest(requestId) {
      const rows = await database.requestAttachment.findMany({
        where: { requestId },
        select: summary,
        orderBy: [{ createdAt: "asc" }, { requirementNameSnapshot: "asc" }, { id: "asc" }],
      });
      return rows.map(toSummary);
    },
    async findMissingRequirements(requestId) {
      const row = await database.request.findUnique({
        where: { id: requestId },
        select: {
          requesterId: true,
          status: true,
          service: {
            select: {
              documentRequirements: {
                where: { isActive: true, attachments: { none: { requestId } } },
                orderBy: [{ position: "asc" }, { id: "asc" }],
                select: { id: true, name: true, isRequired: true, acceptedFormats: true },
              },
            },
          },
        },
      });
      return row && { requesterId: row.requesterId, status: row.status, requirements: row.service.documentRequirements };
    },
    async findInRequest(requestId, attachmentId) {
      const row = await database.requestAttachment.findFirst({
        // A file removed by an anonymization is never served (SPEC 2026-11-02-auditoria-lgpd, 5.5.3).
        where: { id: attachmentId, requestId, removedAt: null },
        select: stored,
      });
      return row && toStored(row);
    },
  };
}

export function createPrismaRequestExistenceReader(database: PrismaClient): RequestExistenceReader {
  return {
    async existingRequestIds(requestIds) {
      const rows = await database.request.findMany({
        where: { id: { in: requestIds } },
        select: { id: true },
      });
      return new Set(rows.map(({ id }) => id));
    },
  };
}
