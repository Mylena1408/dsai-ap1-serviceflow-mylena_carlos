import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";
import { minimalPdf, syntheticText } from "../unit/modules/attachments/synthetic-files";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { runOutbox } from "@/modules/events";
import { notificationConsumer } from "@/modules/notifications";
import { addLateDocument, getRequesterRequest, listMissingDocuments, listRequestAttachments } from "@/modules/requests";
import { encryptWebhookSecret, generateWebhookSecret, webhookConsumer } from "@/modules/webhooks";
import { createMemoryDocumentStorage } from "@/server/storage";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";

// SPEC 2026-11-03-anexos-comentarios-documentos, 5.3 over the database (SF-126; CA-ANX-05 and 06).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };

function actAs(actor: Actor) {
  session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
}

afterAll(() => {
  delete process.env.WEBHOOK_ENCRYPTION_KEY;
});

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const optional = await prisma.serviceDocumentRequirement.create({
    data: { serviceId: service.id, name: "Comprovante", isRequired: false, acceptedFormats: ["PDF"], position: 0 },
  });
  const inactive = await prisma.serviceDocumentRequirement.create({
    data: { serviceId: service.id, name: "Antigo", isRequired: false, acceptedFormats: ["PDF"], position: 1, isActive: false },
  });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const request = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: sector.id });
  await prisma.request.update({ where: { id: request.id }, data: { createdAt: new Date(Date.now() - 60_000) } });
  return { sector, optional, inactive, rita, ana, request };
}

describe("document after the opening over the database (SF-126)", () => {
  it("lists what is missing, stores the document and notifies the assignee and the webhook (CA-ANX-05)", async () => {
    process.env.WEBHOOK_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    const { optional, rita, ana, request } = await scenario();
    const webhook = await prisma.webhookEndpoint.create({
      data: {
        name: "Documentos",
        url: "https://hooks.exemplo.com/documentos",
        eventTypes: ["request.document_added"],
        encryptedSecret: encryptWebhookSecret(generateWebhookSecret(), Buffer.from(process.env.WEBHOOK_ENCRYPTION_KEY, "base64")),
      },
    });
    await prisma.request.update({ where: { id: request.id }, data: { assigneeId: ana.id } });
    const storage = createMemoryDocumentStorage();
    actAs(rita);

    await expect(listMissingDocuments(request.id, prisma)).resolves.toEqual([
      { id: optional.id, name: "Comprovante", isRequired: false, acceptedFormats: ["PDF"] },
    ]);
    await addLateDocument({ requestId: request.id, requirementId: optional.id, file: { name: "comprovante.pdf", bytes: minimalPdf() } }, prisma, storage);

    expect(storage.size).toBe(1);
    await expect(listMissingDocuments(request.id, prisma)).resolves.toEqual([]);
    expect((await listRequestAttachments(request.id, prisma)).map(({ requirementNameSnapshot }) => requirementNameSnapshot)).toEqual(["Comprovante"]);
    const own = await getRequesterRequest(request.id, prisma);
    expect(own.attachments?.map(({ requirementNameSnapshot, uploadedBy }) => [requirementNameSnapshot, uploadedBy.id])).toEqual([["Comprovante", rita.id]]);

    await runOutbox([notificationConsumer(prisma), webhookConsumer(prisma)], { maxBatches: 5 }, prisma);
    await expect(
      prisma.requestNotification.findMany({ where: { requestId: request.id, type: "document.added" }, select: { recipientId: true } }),
    ).resolves.toEqual([{ recipientId: ana.id }]);
    await expect(prisma.webhookDelivery.count({ where: { endpointId: webhook.id, eventType: "request.document_added" } })).resolves.toBe(1);
  });

  it("refuses with the codes of the rules and writes nothing (CA-ANX-06)", async () => {
    const { optional, inactive, rita, ana, request } = await scenario();
    const storage = createMemoryDocumentStorage();
    const send = (input: Record<string, unknown> = {}) =>
      addLateDocument({ requestId: request.id, requirementId: optional.id, file: { name: "comprovante.pdf", bytes: minimalPdf() }, ...input }, prisma, storage);

    actAs(rita);
    await expect(send({ requirementId: inactive.id })).rejects.toThrow(ValidationError);
    await expect(send({ file: { name: "nota.txt", bytes: syntheticText() } })).rejects.toThrow(ValidationError);
    actAs(ana);
    await expect(send()).rejects.toThrow(NotFoundError);
    await expect(listMissingDocuments(request.id, prisma)).resolves.toEqual([]);

    await prisma.request.update({ where: { id: request.id }, data: { status: "COMPLETED", completedAt: new Date() } });
    actAs(rita);
    await expect(send()).rejects.toThrow(ConflictError);
    await expect(listMissingDocuments(request.id, prisma)).resolves.toEqual([]);

    expect(storage.size).toBe(0);
    await expect(prisma.requestAttachment.count({ where: { requestId: request.id } })).resolves.toBe(0);
  });
});
