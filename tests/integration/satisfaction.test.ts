import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { getAnalytics } from "@/modules/reports";
import { getRequestSatisfaction, rateRequest } from "@/modules/requests";
import { anonymizeUser } from "@/modules/users";
import { createMemoryDocumentStorage } from "@/server/storage";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { GET as downloadPersonalData } from "@/app/api/account/data/route";

// SPEC 2026-11-06-pesquisa-satisfacao over the database (SF-150 and SF-151; CA-SAT-01 to 07).

type Actor = { id: string; name: string; email: string; role: Role; sectorId: string | null };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, isActive: true });
const DAY = 24 * 60 * 60 * 1000;

async function scenario() {
  const sector = await createDomainSector();
  const otherSector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const otherRequester = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const caio = await createDomainUser({ role: "ATTENDANT", sectorId: otherSector.id });
  const gabi = await createDomainUser({ role: "MANAGER", sectorId: sector.id });
  const admin = await createDomainUser({ role: "ADMIN" });
  const request = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: sector.id });
  // Completed one day ago, by the database clock.
  await prisma.$executeRaw`UPDATE "Request" SET "status" = 'COMPLETED', "completedAt" = now() - interval '1 day' WHERE "id" = ${request.id}::uuid`;
  return { sector, rita, otherRequester, ana, caio, gabi, admin, request };
}

describe("satisfaction schema (CA-SAT-07)", () => {
  it("refuses a rating out of 1 to 5, an empty or long comment and a second row per request", async () => {
    const { rita, request } = await scenario();
    const row = (data: Record<string, unknown>) =>
      prisma.requestSatisfaction.create({
        data: { requestId: request.id, requesterId: rita.id, rating: 3, completedAtSnapshot: new Date(), ratedAt: new Date(), ...data },
      });
    await expect(row({ rating: 0 })).rejects.toThrow();
    await expect(row({ rating: 6 })).rejects.toThrow();
    await expect(row({ comment: "" })).rejects.toThrow();
    await expect(row({ comment: "x".repeat(1001) })).rejects.toThrow();
    await row({ comment: null });
    await expect(row({})).rejects.toThrow();
    await expect(
      prisma.requestSatisfactionEvent.create({ data: { requestId: request.id, actorId: rita.id, rating: 9, replaced: false, occurredAt: new Date() } }),
    ).rejects.toThrow();
  });
});

describe("rating a request (CA-SAT-01 to 04)", () => {
  it("lets the owner rate once, shows it to the team and the reading manager, never to another sector", async () => {
    const { rita, ana, caio, gabi, admin, request } = await scenario();
    await prisma.userPermission.create({ data: { userId: gabi.id, permission: "SECTOR_REQUESTS_READ", grantedById: admin.id, grantedAt: new Date() } });

    actAs(rita);
    const before = await getRequestSatisfaction(request.id, prisma);
    expect(before).toMatchObject({ current: null, availability: "available" });
    await rateRequest({ requestId: request.id, rating: "4", comment: "Rápido e atencioso" }, prisma);
    const after = await getRequestSatisfaction(request.id, prisma);
    expect(after.availability).toBe("rated");
    expect(after.current).toMatchObject({ rating: 4, comment: "Rápido e atencioso" });
    expect(after.history).toEqual([expect.objectContaining({ rating: 4, replaced: false })]);
    await expect(rateRequest({ requestId: request.id, rating: 5 }, prisma)).rejects.toThrow(ConflictError);

    for (const reader of [ana, gabi]) {
      actAs(reader);
      expect((await getRequestSatisfaction(request.id, prisma)).current).toMatchObject({ rating: 4, comment: "Rápido e atencioso" });
    }
    for (const outsider of [caio, admin]) {
      actAs(outsider);
      await expect(getRequestSatisfaction(request.id, prisma)).rejects.toThrow(NotFoundError);
    }
  });

  it("refuses others, open requests, late ratings and invalid input, writing nothing", async () => {
    const { rita, otherRequester, ana, request } = await scenario();
    for (const actor of [otherRequester, ana]) {
      actAs(actor);
      await expect(rateRequest({ requestId: request.id, rating: 3 }, prisma)).rejects.toThrow(NotFoundError);
    }
    actAs(rita);
    await expect(rateRequest({ requestId: request.id, rating: 7 }, prisma)).rejects.toThrow(ValidationError);
    await expect(rateRequest({ requestId: request.id, rating: 3, comment: "x".repeat(1001) }, prisma)).rejects.toThrow(ValidationError);

    await prisma.$executeRaw`UPDATE "Request" SET "completedAt" = now() - interval '31 days' WHERE "id" = ${request.id}::uuid`;
    await expect(rateRequest({ requestId: request.id, rating: 3 }, prisma)).rejects.toThrow(ConflictError);
    await prisma.request.update({ where: { id: request.id }, data: { status: "IN_PROGRESS", completedAt: null } });
    await expect(rateRequest({ requestId: request.id, rating: 3 }, prisma)).rejects.toThrow(ConflictError);

    await expect(prisma.requestSatisfaction.count({ where: { requestId: request.id } })).resolves.toBe(0);
    await expect(prisma.requestSatisfactionEvent.count({ where: { requestId: request.id } })).resolves.toBe(0);
  });

  it("lets a new completion be rated again, replacing the rating and keeping both in the history (CA-SAT-03)", async () => {
    const { rita, request } = await scenario();
    actAs(rita);
    await rateRequest({ requestId: request.id, rating: 2, comment: "Não resolveu" }, prisma);
    // Reopened and completed again: a new completion instant.
    await prisma.$executeRaw`UPDATE "Request" SET "completedAt" = now() WHERE "id" = ${request.id}::uuid`;
    await rateRequest({ requestId: request.id, rating: 5 }, prisma);

    const view = await getRequestSatisfaction(request.id, prisma);
    expect(view.current).toMatchObject({ rating: 5, comment: null });
    expect(view.history.map(({ rating, replaced }) => [rating, replaced])).toEqual([
      [2, false],
      [5, true],
    ]);
    await expect(prisma.requestSatisfaction.count({ where: { requestId: request.id } })).resolves.toBe(1);
  });
});

describe("analytics and personal data (CA-SAT-05 and 06)", () => {
  it("counts the ratings of the period in the analytics, without comments", async () => {
    const { sector, rita, admin, request } = await scenario();
    actAs(rita);
    await rateRequest({ requestId: request.id, rating: 4, comment: "Comentário que não vai para as análises" }, prisma);

    actAs(admin);
    const analytics = await getAnalytics({ period: "7", sector: sector.id }, prisma);
    expect(analytics.satisfaction).toMatchObject({ count: 1, average: 4, responseRate: 100 });
    expect(analytics.satisfaction.distribution.find((row) => row.rating === 4)?.count).toBe(1);
    expect(JSON.stringify(analytics)).not.toContain("Comentário que não vai");
  });

  it("lists the rating in the personal data and anonymizes the comment, keeping the rating", async () => {
    const { rita, admin, request } = await scenario();
    actAs(rita);
    await rateRequest({ requestId: request.id, rating: 5, comment: "Meu telefone é 99999-0000" }, prisma);
    const file = JSON.parse(await (await downloadPersonalData()).text());
    expect(file.solicitacoesQueVoceAbriu[0].avaliacao).toMatchObject({ nota: 5, comentario: "Meu telefone é 99999-0000" });

    await prisma.user.update({ where: { id: rita.id }, data: { isActive: false } });
    actAs(admin);
    await anonymizeUser({ userId: rita.id, confirmed: true }, prisma, createMemoryDocumentStorage());
    await expect(prisma.requestSatisfaction.findUniqueOrThrow({ where: { requestId: request.id } })).resolves.toMatchObject({
      rating: 5,
      comment: "[conteúdo removido na anonimização]",
    });
    expect(Date.now() - (await prisma.request.findUniqueOrThrow({ where: { id: request.id } })).completedAt!.getTime()).toBeLessThan(2 * DAY);
  });
});
