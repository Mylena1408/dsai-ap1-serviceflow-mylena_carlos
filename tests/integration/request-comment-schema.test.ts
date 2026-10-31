import { describe, expect, it } from "vitest";
import { prisma } from "./fixtures";
import {
  createDomainCategory,
  createDomainRequest,
  createDomainSector,
  createDomainService,
  createDomainUser,
} from "./domain-fixtures";

// SPEC 2026-10-31-comentarios, section 6 (SF-053): additive migration and constraints.

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const requester = await createDomainUser({ role: "REQUESTER" });
  const request = await createDomainRequest({ requesterId: requester.id, serviceId: service.id, sectorId: sector.id });
  return { requester, request };
}

describe("request comment schema (SF-053)", () => {
  it("stores plain comments with 1 to 5,000 characters and no surrounding spaces", async () => {
    const { requester, request } = await scenario();
    const comment = (body: string) =>
      prisma.requestComment.create({ data: { requestId: request.id, authorId: requester.id, body } });

    for (const body of ["", " texto", "texto ", "a".repeat(5_001)]) {
      await expect(comment(body)).rejects.toThrow();
    }
    await expect(comment("a".repeat(5_000))).resolves.toMatchObject({ isInternal: false });
    await expect(comment("<script>alert(1)</script>")).resolves.toMatchObject({
      body: "<script>alert(1)</script>",
    });
  });

  it("keeps commented requests and authors from being deleted", async () => {
    const { requester, request } = await scenario();
    await prisma.requestComment.create({ data: { requestId: request.id, authorId: requester.id, body: "Oi" } });

    await expect(prisma.user.delete({ where: { id: requester.id } })).rejects.toThrow();
    await expect(prisma.request.delete({ where: { id: request.id } })).rejects.toThrow();
  });
});
