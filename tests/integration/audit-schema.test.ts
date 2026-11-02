import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "./fixtures";
import {
  createDomainCategory,
  createDomainRequest,
  createDomainSector,
  createDomainService,
  createDomainUser,
} from "./domain-fixtures";

// SPEC 2026-11-02-auditoria-lgpd, section 6 (SF-102; CA-AUD-10).

describe("audit schema (SF-102)", () => {
  it("starts with no audit entries, nobody anonymized and no attachment removed (CA-AUD-10)", async () => {
    const user = await createDomainUser({ role: "REQUESTER" });

    await expect(prisma.auditEntry.count()).resolves.toBe(0);
    await expect(prisma.user.findUniqueOrThrow({ where: { id: user.id } })).resolves.toMatchObject({ anonymizedAt: null });
    await expect(prisma.requestAttachment.count({ where: { removedAt: { not: null } } })).resolves.toBe(0);
  });

  it("stores an entry with its changes, empty by default, and keeps its actor", async () => {
    const admin = await createDomainUser({ role: "ADMIN" });
    const sector = await createDomainSector();

    const entry = await prisma.auditEntry.create({
      data: {
        actorId: admin.id,
        actorRole: "ADMIN",
        action: "UPDATED",
        entityType: "SECTOR",
        entityId: sector.id,
        entityLabel: sector.name,
        changes: [{ field: "name", before: "TI", after: "Tecnologia" }],
      },
    });
    expect(entry).toMatchObject({
      actorRole: "ADMIN",
      action: "UPDATED",
      changes: [{ field: "name", before: "TI", after: "Tecnologia" }],
    });
    expect(entry.occurredAt).toBeInstanceOf(Date);

    const exported = await prisma.auditEntry.create({
      data: { actorId: admin.id, actorRole: "ADMIN", action: "EXPORTED", entityType: "USER", entityId: admin.id, entityLabel: "x" },
    });
    expect(exported.changes).toEqual([]);

    // The actor of an entry cannot be deleted: anonymization keeps the person, never deletes it.
    await expect(prisma.user.delete({ where: { id: admin.id } })).rejects.toThrow();
  });

  it("accepts the new nullable columns", async () => {
    const user = await createDomainUser({ role: "REQUESTER" });
    const sector = await createDomainSector();
    const category = await createDomainCategory();
    const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
    const request = await createDomainRequest({ requesterId: user.id, serviceId: service.id, sectorId: sector.id });
    const requirement = await prisma.serviceDocumentRequirement.create({
      data: { serviceId: service.id, name: "Comprovante", isRequired: true, position: 0, acceptedFormats: ["PDF"] },
    });
    const now = new Date();

    await expect(prisma.user.update({ where: { id: user.id }, data: { anonymizedAt: now } })).resolves.toMatchObject({
      anonymizedAt: now,
    });
    const attachmentId = randomUUID();
    const attachment = await prisma.requestAttachment.create({
      data: {
        id: attachmentId,
        requestId: request.id,
        requirementId: requirement.id,
        requirementNameSnapshot: requirement.name,
        requirementRequiredSnapshot: true,
        originalFilename: "comprovante.pdf",
        detectedFormat: "PDF",
        contentType: "application/pdf",
        sizeBytes: 10,
        sha256: "a".repeat(64),
        storageKey: `requests/${request.id}/${attachmentId}`,
        uploadedById: user.id,
        removedAt: now,
      },
    });
    expect(attachment.removedAt).toEqual(now);
  });
});
