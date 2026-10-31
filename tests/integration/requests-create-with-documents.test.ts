import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentFormat } from "@prisma/client";
import { prisma } from "./fixtures";
import { NotFoundError, ValidationError } from "@/server/errors";
import {
  createMemoryDocumentStorage,
  createUnavailableDocumentStorage,
  DocumentStorageError,
} from "@/server/storage";
import {
  createDomainCategory,
  createDomainSector,
  createDomainService,
  createDomainUser,
} from "./domain-fixtures";
import { minimalDocx, minimalPdf, syntheticText } from "../unit/modules/attachments/synthetic-files";

const authenticated = vi.hoisted(() => ({
  requireRequestCreator: vi.fn(),
}));

vi.mock("@/server/authorization", () => authenticated);

import { createRequest } from "@/modules/requests";
import { sha256Hex } from "@/modules/attachments";

async function createRequirement(
  serviceId: string,
  input: { name: string; isRequired: boolean; acceptedFormats: DocumentFormat[]; position: number },
) {
  return prisma.serviceDocumentRequirement.create({ data: { serviceId, ...input } });
}

async function scenario() {
  const requester = await createDomainUser({ role: "REQUESTER" });
  authenticated.requireRequestCreator.mockResolvedValue(requester);
  const category = await createDomainCategory();
  const sector = await createDomainSector();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const form = await createRequirement(service.id, {
    name: "Requerimento de férias",
    isRequired: true,
    acceptedFormats: ["PDF", "DOCX"],
    position: 0,
  });
  const authorization = await createRequirement(service.id, {
    name: "Documento de autorização",
    isRequired: false,
    acceptedFormats: ["TXT"],
    position: 1,
  });

  return { requester, category, sector, service, form, authorization };
}

async function expectNothingPersisted(storage: { size: number }) {
  await expect(prisma.request.count()).resolves.toBe(0);
  await expect(prisma.requestStatusEvent.count()).resolves.toBe(0);
  await expect(prisma.requestAttachment.count()).resolves.toBe(0);
  expect(storage.size).toBe(0);
}

describe("request opening with required documents (SF-034)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`
      DROP TRIGGER IF EXISTS reject_serviceflow_attachment ON public."RequestAttachment";
    `);
    await prisma.$executeRawUnsafe(`
      DROP FUNCTION IF EXISTS public.reject_serviceflow_attachment();
    `);
  });

  it("persists request, initial event and complete attachment metadata atomically (CA-DOC-13)", async () => {
    const { requester, service, form, authorization } = await scenario();
    const storage = createMemoryDocumentStorage();

    const created = await createRequest(
      {
        serviceId: service.id,
        description: "Pedido de férias",
        attachments: [
          { requirementId: form.id, name: "requerimento.pdf", bytes: minimalPdf() },
          { requirementId: authorization.id, name: "autorizacao.txt", bytes: syntheticText() },
        ],
      },
      prisma,
      storage,
    );

    expect(created.events).toHaveLength(1);
    const attachments = await prisma.requestAttachment.findMany({
      where: { requestId: created.id },
      orderBy: { requirementNameSnapshot: "desc" },
    });
    expect(attachments).toHaveLength(2);
    expect(attachments[0]).toMatchObject({
      requirementId: form.id,
      requirementNameSnapshot: "Requerimento de férias",
      requirementRequiredSnapshot: true,
      originalFilename: "requerimento.pdf",
      detectedFormat: "PDF",
      contentType: "application/pdf",
      sizeBytes: minimalPdf().length,
      sha256: sha256Hex(minimalPdf()),
      storageKey: `requests/${created.id}/${attachments[0].id}`,
      uploadedById: requester.id,
      createdAt: created.createdAt,
    });
    expect(attachments[1]).toMatchObject({ requirementId: authorization.id, detectedFormat: "TXT" });

    for (const attachment of attachments) {
      expect(sha256Hex(await storage.get(attachment.storageKey))).toBe(attachment.sha256);
    }
  });

  it("opens with only the required document and refuses a missing one (CA-DOC-07)", async () => {
    const { service, form, authorization } = await scenario();
    const storage = createMemoryDocumentStorage();

    await expect(
      createRequest(
        {
          serviceId: service.id,
          description: "Sem obrigatório",
          attachments: [{ requirementId: authorization.id, name: "a.txt", bytes: syntheticText() }],
        },
        prisma,
        storage,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createRequest({ serviceId: service.id, description: "Sem arquivos" }, prisma, storage),
    ).rejects.toBeInstanceOf(ValidationError);
    await expectNothingPersisted(storage);

    const created = await createRequest(
      {
        serviceId: service.id,
        description: "Só o obrigatório",
        attachments: [{ requirementId: form.id, name: "form.docx", bytes: minimalDocx() }],
      },
      prisma,
      storage,
    );
    await expect(prisma.requestAttachment.count({ where: { requestId: created.id } })).resolves.toBe(1);
  });

  it("keeps services without requirements unchanged and rejects files sent to them (CA-DOC-05)", async () => {
    const requester = await createDomainUser({ role: "REQUESTER" });
    authenticated.requireRequestCreator.mockResolvedValue(requester);
    const category = await createDomainCategory();
    const sector = await createDomainSector();
    const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
    const { form } = await scenario();
    authenticated.requireRequestCreator.mockResolvedValue(requester);
    const storage = createMemoryDocumentStorage();

    await expect(
      createRequest(
        {
          serviceId: service.id,
          description: "Arquivo indevido",
          attachments: [{ requirementId: form.id, name: "form.pdf", bytes: minimalPdf() }],
        },
        prisma,
        storage,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expectNothingPersisted(storage);

    const created = await createRequest({ serviceId: service.id, description: "Sem documentos" }, prisma);
    expect(created.status).toBe("OPEN");
    await expect(prisma.requestAttachment.count()).resolves.toBe(0);
  });

  it("rejects inactive, foreign and duplicated requirements without persisting (CA-DOC-08, CA-DOC-12)", async () => {
    const { service, form, authorization } = await scenario();
    const other = await scenario();
    await prisma.serviceDocumentRequirement.update({
      where: { id: authorization.id },
      data: { isActive: false },
    });
    const storage = createMemoryDocumentStorage();
    const pdf = (requirementId: string) => ({ requirementId, name: "f.pdf", bytes: minimalPdf() });
    const txt = (requirementId: string) => ({ requirementId, name: "f.txt", bytes: syntheticText() });

    for (const attachments of [
      [pdf(form.id), pdf(other.form.id)],
      [pdf(form.id), pdf(form.id)],
      [pdf(form.id), txt(authorization.id)],
      [pdf(form.id), pdf(randomUUID())],
    ]) {
      await expect(
        createRequest({ serviceId: service.id, description: "Inválido", attachments }, prisma, storage),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    await expectNothingPersisted(storage);
  });

  it("rejects forged protected fields before writing anything (CA-DOC-13)", async () => {
    const { service, form } = await scenario();
    const storage = createMemoryDocumentStorage();

    await expect(
      createRequest(
        {
          serviceId: service.id,
          description: "Forjado",
          attachments: [
            {
              requirementId: form.id,
              name: "f.pdf",
              bytes: minimalPdf(),
              storageKey: `requests/${randomUUID()}/${randomUUID()}`,
              detectedFormat: "PDF",
              uploadedById: randomUUID(),
            },
          ],
        },
        prisma,
        storage,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expectNothingPersisted(storage);
  });

  it("rolls back and removes stored objects when the attachment insert fails (CA-DOC-12)", async () => {
    const { service, form, authorization } = await scenario();
    const storage = createMemoryDocumentStorage();

    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION public.reject_serviceflow_attachment()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'integration attachment failure';
      END;
      $$;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER reject_serviceflow_attachment
      BEFORE INSERT ON public."RequestAttachment"
      FOR EACH ROW EXECUTE FUNCTION public.reject_serviceflow_attachment();
    `);

    try {
      await expect(
        createRequest(
          {
            serviceId: service.id,
            description: "Falha na transação",
            attachments: [
              { requirementId: form.id, name: "f.pdf", bytes: minimalPdf() },
              { requirementId: authorization.id, name: "f.txt", bytes: syntheticText() },
            ],
          },
          prisma,
          storage,
        ),
      ).rejects.toThrow();
      await expectNothingPersisted(storage);
    } finally {
      await prisma.$executeRawUnsafe(`
        DROP TRIGGER IF EXISTS reject_serviceflow_attachment ON public."RequestAttachment";
      `);
      await prisma.$executeRawUnsafe(`
        DROP FUNCTION IF EXISTS public.reject_serviceflow_attachment();
      `);
    }
  });

  it("removes stored objects when the service becomes unavailable before the transaction", async () => {
    const { service, form } = await scenario();
    const memory = createMemoryDocumentStorage();
    const storage = {
      ...memory,
      get: memory.get,
      remove: memory.remove,
      async put(key: string, bytes: Uint8Array, contentType: string) {
        await memory.put(key, bytes, contentType);
        await prisma.service.update({ where: { id: service.id }, data: { isActive: false } });
      },
    };

    await expect(
      createRequest(
        {
          serviceId: service.id,
          description: "Serviço desativado no meio",
          attachments: [{ requirementId: form.id, name: "f.pdf", bytes: minimalPdf() }],
        },
        prisma,
        storage,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expectNothingPersisted(memory);
  });

  it("refuses files when no storage is configured and opens nothing", async () => {
    const { service, form } = await scenario();
    const unavailable = { ...createUnavailableDocumentStorage(), size: 0 };

    await expect(
      createRequest(
        {
          serviceId: service.id,
          description: "Sem armazenamento",
          attachments: [{ requirementId: form.id, name: "f.pdf", bytes: minimalPdf() }],
        },
        prisma,
        unavailable,
      ),
    ).rejects.toBeInstanceOf(DocumentStorageError);
    await expectNothingPersisted(unavailable);
  });
});
