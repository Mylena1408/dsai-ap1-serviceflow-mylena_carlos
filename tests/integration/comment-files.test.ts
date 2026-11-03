import { describe, expect, it, vi } from "vitest";
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

import { addComment, getCommentFileDownload, listComments } from "@/modules/comments";
import { anonymizeUser } from "@/modules/users";
import { createMemoryDocumentStorage } from "@/server/storage";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { GET as downloadPersonalData } from "@/app/api/account/data/route";

// SPEC 2026-11-03-anexos-comentarios-documentos over the database (SF-125; CA-ANX-02 to 04, 07, 08).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };

function actAs(actor: Actor) {
  session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
}

async function scenario() {
  const sector = await createDomainSector();
  const otherSector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const caio = await createDomainUser({ role: "ATTENDANT", sectorId: otherSector.id });
  const admin = await createDomainUser({ role: "ADMIN" });
  const request = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: sector.id });
  return { rita, ana, caio, admin, request };
}

describe("comment files over the database (SF-125)", () => {
  it("stores, lists and downloads the files with the visibility of the comment (CA-ANX-02 and 04)", async () => {
    const { rita, ana, caio, request } = await scenario();
    const storage = createMemoryDocumentStorage();
    const pdf = minimalPdf();

    actAs(rita);
    const shared = await addComment({ requestId: request.id, body: "Segue o laudo", files: [{ name: "laudo.pdf", bytes: pdf }] }, prisma, storage);
    actAs(ana);
    const internal = await addComment(
      { requestId: request.id, body: "Orçamento interno", isInternal: true, files: [{ name: "orcamento.txt", bytes: syntheticText() }] },
      prisma,
      storage,
    );
    expect(storage.size).toBe(2);

    // The attendant sees both and downloads the requester's file with the same content.
    const seen = await listComments(request.id, prisma);
    expect(seen.map(({ files }) => files?.map(({ originalFilename }) => originalFilename))).toEqual([["laudo.pdf"], ["orcamento.txt"]]);
    const sharedIds = { requestId: request.id, commentId: shared.id, fileId: shared.files![0]!.id };
    const internalIds = { requestId: request.id, commentId: internal.id, fileId: internal.files![0]!.id };
    await expect(getCommentFileDownload(sharedIds, prisma, storage)).resolves.toMatchObject({ bytes: pdf, filename: "laudo.pdf" });

    // The requester never sees the internal note nor downloads its file.
    actAs(rita);
    expect((await listComments(request.id, prisma)).map(({ id }) => id)).toEqual([shared.id]);
    await expect(getCommentFileDownload(internalIds, prisma, storage)).rejects.toThrow(NotFoundError);
    // A file of another comment under the right ids is not found.
    await expect(getCommentFileDownload({ ...internalIds, commentId: shared.id }, prisma, storage)).rejects.toThrow(NotFoundError);

    // Someone who does not read the request gets "not found".
    actAs(caio);
    await expect(getCommentFileDownload(sharedIds, prisma, storage)).rejects.toThrow(NotFoundError);
  });

  it("refuses without writing anything (CA-ANX-03 and 07)", async () => {
    const { rita, request } = await scenario();
    const storage = createMemoryDocumentStorage();
    actAs(rita);

    await expect(
      addComment({ requestId: request.id, body: "Oi", files: [{ name: "laudo.txt", bytes: minimalPdf() }] }, prisma, storage),
    ).rejects.toThrow(ValidationError);
    await prisma.request.update({ where: { id: request.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    await expect(
      addComment({ requestId: request.id, body: "Oi", files: [{ name: "laudo.pdf", bytes: minimalPdf() }] }, prisma, storage),
    ).rejects.toThrow(ConflictError);

    expect(storage.size).toBe(0);
    await expect(prisma.requestComment.count({ where: { requestId: request.id } })).resolves.toBe(0);
    await expect(prisma.requestCommentFile.count({ where: { requestId: request.id } })).resolves.toBe(0);
  });

  it("refuses the 31st file of the request", async () => {
    const { rita, request } = await scenario();
    const storage = createMemoryDocumentStorage();
    actAs(rita);
    for (let index = 0; index < 10; index += 1) {
      const files = [0, 1, 2].map((n) => ({ name: `nota-${index}-${n}.txt`, bytes: syntheticText() }));
      await addComment({ requestId: request.id, body: `Lote ${index}`, files }, prisma, storage);
    }

    await expect(
      addComment({ requestId: request.id, body: "Mais um", files: [{ name: "extra.txt", bytes: syntheticText() }] }, prisma, storage),
    ).rejects.toThrow(ValidationError);
    expect(storage.size).toBe(30);
  });

  it("lists the names in \"Meus dados\" and removes the files on anonymization (CA-ANX-08)", async () => {
    const { rita, ana, admin, request } = await scenario();
    const storage = createMemoryDocumentStorage();
    actAs(rita);
    await addComment({ requestId: request.id, body: "Segue o laudo", files: [{ name: "laudo.pdf", bytes: minimalPdf() }] }, prisma, storage);

    const file = JSON.parse(await (await downloadPersonalData()).text());
    expect(file.solicitacoesQueVoceAbriu[0].comentarios).toEqual([expect.objectContaining({ texto: "Segue o laudo", arquivos: ["laudo.pdf"] })]);

    // Anonymization needs no open request of the person (SPEC de auditoria e LGPD).
    await prisma.request.update({ where: { id: request.id }, data: { status: "COMPLETED", completedAt: new Date() } });
    await prisma.user.update({ where: { id: rita.id }, data: { isActive: false } });
    actAs(admin);
    await anonymizeUser({ userId: rita.id, confirmed: true }, prisma, storage);

    expect(storage.size).toBe(0);
    await expect(prisma.requestCommentFile.findFirstOrThrow({ where: { requestId: request.id } })).resolves.toMatchObject({
      originalFilename: "Arquivo removido na anonimização",
    });
    actAs(ana);
    const [comment] = await listComments(request.id, prisma);
    expect(comment?.files).toEqual([expect.objectContaining({ removed: true })]);
    await expect(
      getCommentFileDownload({ requestId: request.id, commentId: comment!.id, fileId: comment!.files![0]!.id }, prisma, storage),
    ).rejects.toThrow(NotFoundError);
  });
});
