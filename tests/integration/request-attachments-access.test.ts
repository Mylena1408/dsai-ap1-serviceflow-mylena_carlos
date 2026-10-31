import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { AuthenticationError, NotFoundError } from "@/server/errors";
import { createMemoryDocumentStorage } from "@/server/storage";
import {
  createDomainCategory,
  createDomainSector,
  createDomainService,
  createDomainUser,
} from "./domain-fixtures";
import { minimalPdf, syntheticText } from "../unit/modules/attachments/synthetic-files";

const session = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { sha256Hex } from "@/modules/attachments";
import { createRequest, getAttachmentDownload, listRequestAttachments } from "@/modules/requests";

type Actor = { id: string; role: Role; sectorId: string | null; isActive: boolean };

function actAs(actor: Actor | null) {
  session.getCurrentUser.mockResolvedValue(
    actor && { ...actor, name: "Integration user", email: `${actor.id}@example.test` },
  );
}

async function scenario() {
  const category = await createDomainCategory();
  const sector = await createDomainSector();
  const otherSector = await createDomainSector();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const form = await prisma.serviceDocumentRequirement.create({
    data: { serviceId: service.id, name: "Requerimento", isRequired: true, acceptedFormats: ["PDF"], position: 0 },
  });
  const note = await prisma.serviceDocumentRequirement.create({
    data: { serviceId: service.id, name: "Observação", isRequired: false, acceptedFormats: ["TXT"], position: 1 },
  });
  const owner = await createDomainUser({ role: "REQUESTER" });
  const otherRequester = await createDomainUser({ role: "REQUESTER" });
  const attendant = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const otherAttendant = await createDomainUser({ role: "ATTENDANT", sectorId: otherSector.id });
  const admin = await createDomainUser({ role: "ADMIN" });
  const storage = createMemoryDocumentStorage();

  async function open(description: string) {
    actAs(owner);
    return createRequest(
      {
        serviceId: service.id,
        description,
        attachments: [
          { requirementId: form.id, name: "requerimento.pdf", bytes: minimalPdf() },
          { requirementId: note.id, name: "observacao.txt", bytes: syntheticText() },
        ],
      },
      prisma,
      storage,
    );
  }

  const request = await open("Pedido com documentos");
  const attachments = await prisma.requestAttachment.findMany({ where: { requestId: request.id } });

  return {
    category,
    sector,
    otherSector,
    service,
    form,
    owner,
    otherRequester,
    attendant,
    otherAttendant,
    admin,
    storage,
    open,
    request,
    attachments,
  };
}

describe("attachment listing and download (SF-035)", () => {
  it("lets the owner and an attendant of the sector list and download identical content (CA-DOC-14, CA-DOC-15)", async () => {
    const { owner, attendant, request, attachments, storage } = await scenario();

    for (const actor of [owner, attendant]) {
      actAs(actor);
      const listed = await listRequestAttachments(request.id, prisma);

      expect(listed.map(({ originalFilename }) => originalFilename).sort()).toEqual([
        "observacao.txt",
        "requerimento.pdf",
      ]);
      for (const summary of listed) {
        expect(Object.keys(summary).sort()).toEqual([
          "createdAt",
          "detectedFormat",
          "id",
          "originalFilename",
          "requirementNameSnapshot",
          "requirementRequiredSnapshot",
          "sizeBytes",
        ]);
      }

      for (const attachment of attachments) {
        const download = await getAttachmentDownload(request.id, attachment.id, prisma, storage);
        expect(sha256Hex(download.bytes)).toBe(attachment.sha256);
        expect(download.contentType).toBe(attachment.contentType);
        expect(download.filename).toBe(attachment.originalFilename);
      }
    }
  });

  it("denies other users, administrators, inactive and anonymous users the same way (CA-DOC-16)", async () => {
    const { otherRequester, otherAttendant, admin, owner, request, attachments, storage } = await scenario();
    const reads = vi.spyOn(storage, "get");

    for (const actor of [otherRequester, otherAttendant, admin]) {
      actAs(actor);
      await expect(listRequestAttachments(request.id, prisma)).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        getAttachmentDownload(request.id, attachments[0].id, prisma, storage),
      ).rejects.toBeInstanceOf(NotFoundError);
    }

    for (const actor of [{ ...owner, isActive: false }, null]) {
      actAs(actor);
      await expect(
        getAttachmentDownload(request.id, attachments[0].id, prisma, storage),
      ).rejects.toBeInstanceOf(AuthenticationError);
    }

    expect(reads).not.toHaveBeenCalled();
  });

  it("follows the attendant's current sector (CA-DOC-16)", async () => {
    const { attendant, otherSector, request, attachments, storage } = await scenario();
    await prisma.user.update({ where: { id: attendant.id }, data: { sectorId: otherSector.id } });

    actAs({ ...attendant, sectorId: otherSector.id });
    await expect(
      getAttachmentDownload(request.id, attachments[0].id, prisma, storage),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses an attachment of another request named in the URL (CA-DOC-17)", async () => {
    const { owner, open, request, storage } = await scenario();
    const second = await open("Segundo pedido");
    const foreign = await prisma.requestAttachment.findFirstOrThrow({ where: { requestId: second.id } });

    actAs(owner);
    await expect(
      getAttachmentDownload(request.id, foreign.id, prisma, storage),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("keeps metadata and access after editing or deactivating the configuration (CA-DOC-19)", async () => {
    const { owner, attendant, category, sector, service, form, request, attachments, storage } =
      await scenario();
    const before = await prisma.requestAttachment.findMany({ where: { requestId: request.id }, orderBy: { id: "asc" } });

    await prisma.serviceDocumentRequirement.update({
      where: { id: form.id },
      data: { name: "Requerimento renomeado", isRequired: false },
    });
    await prisma.serviceDocumentRequirement.updateMany({
      where: { serviceId: service.id },
      data: { isActive: false },
    });
    await prisma.service.update({ where: { id: service.id }, data: { isActive: false } });
    await prisma.category.update({ where: { id: category.id }, data: { isActive: false } });
    await prisma.sector.update({ where: { id: sector.id }, data: { isActive: false } });
    await prisma.request.update({
      where: { id: request.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    const after = await prisma.requestAttachment.findMany({ where: { requestId: request.id }, orderBy: { id: "asc" } });
    expect(after).toEqual(before);
    expect(after.find(({ requirementId }) => requirementId === form.id)).toMatchObject({
      requirementNameSnapshot: "Requerimento",
      requirementRequiredSnapshot: true,
    });

    for (const actor of [owner, attendant]) {
      actAs(actor);
      await expect(listRequestAttachments(request.id, prisma)).resolves.toHaveLength(2);
      for (const attachment of attachments) {
        const download = await getAttachmentDownload(request.id, attachment.id, prisma, storage);
        expect(sha256Hex(download.bytes)).toBe(attachment.sha256);
      }
    }
  });

  it("returns an empty list for requests opened without documents", async () => {
    const owner = await createDomainUser({ role: "REQUESTER" });
    const category = await createDomainCategory();
    const sector = await createDomainSector();
    const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
    actAs(owner);
    const request = await createRequest({ serviceId: service.id, description: "Sem documentos" }, prisma);

    await expect(listRequestAttachments(request.id, prisma)).resolves.toEqual([]);
  });
});
