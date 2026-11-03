import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";
import { encryptWebhookSecret, generateWebhookSecret } from "@/modules/webhooks";

// SPEC 2026-11-03-anexos-comentarios-documentos, section 6 (SF-124).

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const requester = await createDomainUser({ role: "REQUESTER" });
  const request = await createDomainRequest({ requesterId: requester.id, serviceId: service.id, sectorId: sector.id });
  const other = await createDomainRequest({ requesterId: requester.id, serviceId: service.id, sectorId: sector.id });
  const comment = await prisma.requestComment.create({ data: { requestId: request.id, authorId: requester.id, body: "Segue o laudo" } });
  return { requester, request, other, comment };
}

describe("comment files schema (SF-124)", () => {
  it("keeps a file of a comment with the rules of the documents", async () => {
    const { requester, request, other, comment } = await scenario();
    const file = (overrides: Record<string, unknown> = {}) => {
      const id = randomUUID();
      const requestId = (overrides.requestId as string | undefined) ?? request.id;
      return prisma.requestCommentFile.create({
        data: {
          id,
          requestId,
          commentId: comment.id,
          originalFilename: "laudo.pdf",
          detectedFormat: "PDF",
          contentType: "application/pdf",
          sizeBytes: 1_024,
          sha256: "a".repeat(64),
          storageKey: `requests/${requestId}/${id}`,
          uploadedById: requester.id,
          createdAt: new Date(),
          ...overrides,
        },
      });
    };

    await expect(file()).resolves.toMatchObject({ removedAt: null });

    for (const overrides of [
      { originalFilename: "" },
      { originalFilename: "pasta/laudo.pdf" },
      { contentType: "text/plain" },
      { sizeBytes: 0 },
      { sizeBytes: 2 * 1024 * 1024 + 1 },
      { sha256: "z".repeat(64) },
      { storageKey: `requests/${request.id}/outro` },
      // A file cannot point to a comment of another request.
      { requestId: other.id },
    ]) {
      await expect(file(overrides), JSON.stringify(overrides).slice(0, 60)).rejects.toThrow();
    }
  });

  it("accepts request.document_added in the outbox and in webhooks", async () => {
    const { request } = await scenario();
    await expect(
      prisma.outboxEvent.create({ data: { type: "request.document_added", requestId: request.id, occurredAt: new Date(), availableAt: new Date(), payload: {} } }),
    ).resolves.toBeTruthy();
    await expect(
      prisma.webhookEndpoint.create({
        data: {
          name: "Portal",
          url: "https://hooks.exemplo.com/serviceflow",
          eventTypes: ["request.document_added"],
          encryptedSecret: encryptWebhookSecret(generateWebhookSecret(), randomBytes(32)),
        },
      }),
    ).resolves.toBeTruthy();
  });
});
