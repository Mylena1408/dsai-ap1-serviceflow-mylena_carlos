import { randomUUID } from "node:crypto";
import type { DocumentFormat, Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { prisma } from "./fixtures";
import {
  createDomainCategory,
  createDomainRequest,
  createDomainSector,
  createDomainService,
  createDomainUser,
} from "./domain-fixtures";

const SYNTHETIC_SHA256 = "a".repeat(64);

async function createRequestContext() {
  const requester = await createDomainUser({ role: "REQUESTER" });
  const category = await createDomainCategory();
  const sector = await createDomainSector();
  const service = await createDomainService({
    categoryId: category.id,
    sectorId: sector.id,
  });
  const request = await createDomainRequest({
    requesterId: requester.id,
    serviceId: service.id,
    sectorId: sector.id,
  });

  return { requester, category, sector, service, request };
}

async function createRequirement(
  serviceId: string,
  data: Partial<Prisma.ServiceDocumentRequirementUncheckedCreateInput> = {},
) {
  return prisma.serviceDocumentRequirement.create({
    data: {
      serviceId,
      name: `Synthetic document ${randomUUID()}`,
      isRequired: true,
      acceptedFormats: ["PDF"],
      position: 0,
      ...data,
    },
  });
}

function attachmentData(input: {
  requestId: string;
  requirementId: string;
  uploadedById: string;
  overrides?: Partial<Prisma.RequestAttachmentUncheckedCreateInput>;
}): Prisma.RequestAttachmentUncheckedCreateInput {
  const id = input.overrides?.id ?? randomUUID();

  return {
    id,
    requestId: input.requestId,
    requirementId: input.requirementId,
    requirementNameSnapshot: "Synthetic document",
    requirementRequiredSnapshot: true,
    originalFilename: "synthetic-form.pdf",
    detectedFormat: "PDF",
    contentType: "application/pdf",
    sizeBytes: 128,
    sha256: SYNTHETIC_SHA256,
    storageKey: `requests/${input.requestId}/${id}`,
    uploadedById: input.uploadedById,
    ...input.overrides,
  };
}

describe("service document requirements schema", () => {
  it("stores requirement metadata with active state by default", async () => {
    const { service } = await createRequestContext();

    const requirement = await createRequirement(service.id, {
      name: "Synthetic request form",
      isRequired: false,
      acceptedFormats: ["PDF", "DOCX", "TXT"],
      position: 2,
    });

    await expect(
      prisma.serviceDocumentRequirement.findUniqueOrThrow({ where: { id: requirement.id } }),
    ).resolves.toMatchObject({
      serviceId: service.id,
      name: "Synthetic request form",
      isRequired: false,
      acceptedFormats: ["PDF", "DOCX", "TXT"],
      position: 2,
      isActive: true,
    });
  });

  it("enforces case-insensitive name uniqueness only among active requirements of the same service", async () => {
    const { service, category, sector } = await createRequestContext();
    const otherService = await createDomainService({
      categoryId: category.id,
      sectorId: sector.id,
    });

    const original = await createRequirement(service.id, { name: "Synthetic authorization" });

    await expect(
      createRequirement(service.id, { name: "SYNTHETIC AUTHORIZATION" }),
    ).rejects.toMatchObject({ code: "P2002" });

    await expect(
      createRequirement(otherService.id, { name: "Synthetic authorization" }),
    ).resolves.toMatchObject({ serviceId: otherService.id });

    await prisma.serviceDocumentRequirement.update({
      where: { id: original.id },
      data: { isActive: false },
    });

    await expect(
      createRequirement(service.id, { name: "synthetic authorization" }),
    ).resolves.toMatchObject({ isActive: true });
  });

  it("rejects invalid names, formats, and positions at the PostgreSQL boundary", async () => {
    const { service } = await createRequestContext();

    for (const name of ["", "   ", " padded ", "x".repeat(121)]) {
      await expect(createRequirement(service.id, { name })).rejects.toThrow(
        /ServiceDocumentRequirement_name_check/,
      );
    }

    await expect(createRequirement(service.id, { name: "x".repeat(120) })).resolves.toBeDefined();

    for (const acceptedFormats of [[], ["PDF", "DOCX", "TXT", "PDF"]] as DocumentFormat[][]) {
      await expect(createRequirement(service.id, { acceptedFormats })).rejects.toThrow(
        /ServiceDocumentRequirement_acceptedFormats_check/,
      );
    }

    await expect(createRequirement(service.id, { position: -1 })).rejects.toThrow(
      /ServiceDocumentRequirement_position_check/,
    );

    await expect(
      prisma.$executeRaw`
        INSERT INTO "ServiceDocumentRequirement"
          ("id", "serviceId", "name", "isRequired", "acceptedFormats", "position", "updatedAt")
        VALUES (${randomUUID()}::uuid, ${service.id}::uuid, 'Null formats', true, NULL, 0, now())
      `,
    ).rejects.toThrow(/ServiceDocumentRequirement_acceptedFormats_check/);
  });

  it("rejects requirements for nonexistent services and prevents deleting services with requirements", async () => {
    const category = await createDomainCategory();
    const sector = await createDomainSector();
    const service = await createDomainService({
      categoryId: category.id,
      sectorId: sector.id,
    });

    await expect(
      createRequirement("00000000-0000-4000-8000-000000009981"),
    ).rejects.toMatchObject({ code: "P2003" });

    await createRequirement(service.id);

    await expect(
      prisma.service.delete({ where: { id: service.id } }),
    ).rejects.toMatchObject({ code: "P2003" });
  });
});

describe("request attachments schema", () => {
  it("persists attachment metadata linked to the request, requirement, and uploader", async () => {
    const { requester, request, service } = await createRequestContext();
    const requirement = await createRequirement(service.id);
    const data = attachmentData({
      requestId: request.id,
      requirementId: requirement.id,
      uploadedById: requester.id,
    });

    const attachment = await prisma.requestAttachment.create({ data });

    await expect(
      prisma.request.findUniqueOrThrow({
        where: { id: request.id },
        include: { attachments: true },
      }),
    ).resolves.toMatchObject({
      attachments: [
        {
          id: attachment.id,
          requirementId: requirement.id,
          uploadedById: requester.id,
          detectedFormat: "PDF",
          contentType: "application/pdf",
          sizeBytes: 128,
          sha256: SYNTHETIC_SHA256,
          storageKey: `requests/${request.id}/${attachment.id}`,
        },
      ],
    });
  });

  it("allows at most one attachment per requirement in the same request", async () => {
    const { requester, request, service } = await createRequestContext();
    const requirement = await createRequirement(service.id);
    const base = { requestId: request.id, requirementId: requirement.id, uploadedById: requester.id };

    await prisma.requestAttachment.create({ data: attachmentData(base) });

    await expect(
      prisma.requestAttachment.create({ data: attachmentData(base) }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("rejects invalid file metadata at the PostgreSQL boundary", async () => {
    const { requester, request, service } = await createRequestContext();
    const requirement = await createRequirement(service.id);
    const base = { requestId: request.id, requirementId: requirement.id, uploadedById: requester.id };

    const invalidCases: [Partial<Prisma.RequestAttachmentUncheckedCreateInput>, RegExp][] = [
      [{ sizeBytes: 0 }, /RequestAttachment_sizeBytes_check/],
      [{ sizeBytes: 2_097_153 }, /RequestAttachment_sizeBytes_check/],
      [{ sha256: "A".repeat(64) }, /RequestAttachment_sha256_check/],
      [{ sha256: "g".repeat(64) }, /RequestAttachment_sha256_check/],
      [{ detectedFormat: "TXT", contentType: "application/pdf" }, /RequestAttachment_contentType_check/],
      [{ detectedFormat: "PDF", contentType: "application/octet-stream" }, /RequestAttachment_contentType_check/],
      [{ originalFilename: "" }, /RequestAttachment_originalFilename_check/],
      [{ originalFilename: `${"x".repeat(252)}.pdf` }, /RequestAttachment_originalFilename_check/],
      [{ originalFilename: "../synthetic.pdf" }, /RequestAttachment_originalFilename_check/],
      [{ originalFilename: "folder\\synthetic.pdf" }, /RequestAttachment_originalFilename_check/],
      [{ originalFilename: "synthetic\n.pdf" }, /RequestAttachment_originalFilename_check/],
      [{ requirementNameSnapshot: "" }, /RequestAttachment_requirementNameSnapshot_check/],
      [{ storageKey: "public/synthetic.pdf" }, /RequestAttachment_storageKey_check/],
      [{ storageKey: `requests/${randomUUID()}/${randomUUID()}` }, /RequestAttachment_storageKey_check/],
    ];

    for (const [overrides, constraint] of invalidCases) {
      await expect(
        prisma.requestAttachment.create({ data: attachmentData({ ...base, overrides }) }),
      ).rejects.toThrow(constraint);
    }

    await expect(
      prisma.requestAttachment.create({
        data: attachmentData({
          ...base,
          overrides: {
            sizeBytes: 2_097_152,
            detectedFormat: "DOCX",
            contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            originalFilename: `${"x".repeat(250)}.docx`,
          },
        }),
      }),
    ).resolves.toBeDefined();

    await expect(prisma.requestAttachment.count()).resolves.toBe(1);
  });

  it("rejects references to nonexistent request, requirement, or uploader", async () => {
    const { requester, request, service } = await createRequestContext();
    const requirement = await createRequirement(service.id);
    const missing = "00000000-0000-4000-8000-000000009982";

    for (const reference of [
      { requestId: missing, requirementId: requirement.id, uploadedById: requester.id },
      { requestId: request.id, requirementId: missing, uploadedById: requester.id },
      { requestId: request.id, requirementId: requirement.id, uploadedById: missing },
    ]) {
      await expect(
        prisma.requestAttachment.create({ data: attachmentData(reference) }),
      ).rejects.toMatchObject({ code: "P2003" });
    }
  });

  it("prevents physical deletion of requests, requirements, and uploaders referenced by attachments", async () => {
    const { requester, request, service } = await createRequestContext();
    const requirement = await createRequirement(service.id);

    await prisma.requestAttachment.create({
      data: attachmentData({
        requestId: request.id,
        requirementId: requirement.id,
        uploadedById: requester.id,
      }),
    });

    await expect(
      prisma.serviceDocumentRequirement.delete({ where: { id: requirement.id } }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      prisma.request.delete({ where: { id: request.id } }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      prisma.user.delete({ where: { id: requester.id } }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("preserves attachment metadata and snapshots after the requirement and service are edited or deactivated", async () => {
    const { requester, request, service } = await createRequestContext();
    const requirement = await createRequirement(service.id, {
      name: "Original synthetic requirement",
      isRequired: true,
    });
    const attachment = await prisma.requestAttachment.create({
      data: attachmentData({
        requestId: request.id,
        requirementId: requirement.id,
        uploadedById: requester.id,
        overrides: {
          requirementNameSnapshot: "Original synthetic requirement",
          requirementRequiredSnapshot: true,
        },
      }),
    });

    await prisma.serviceDocumentRequirement.update({
      where: { id: requirement.id },
      data: {
        name: "Renamed synthetic requirement",
        isRequired: false,
        acceptedFormats: ["TXT"],
        isActive: false,
      },
    });
    await prisma.service.update({
      where: { id: service.id },
      data: { name: "Renamed synthetic service", isActive: false },
    });

    await expect(
      prisma.requestAttachment.findUniqueOrThrow({ where: { id: attachment.id } }),
    ).resolves.toEqual(attachment);
  });
});
