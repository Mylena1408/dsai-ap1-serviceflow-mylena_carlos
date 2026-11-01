import { describe, expect, it, vi } from "vitest";
import type { RequestStatus, Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { AuthorizationError, ValidationError } from "@/server/errors";
import {
  createDomainCategory,
  createDomainRequest,
  createDomainSector,
  createDomainService,
  createDomainUser,
} from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { searchAttendantQueue, searchRequesterRequests } from "@/modules/requests";

// SPEC 2026-10-31-busca-filtros-paginacao (SF-058).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };

function actAs(actor: Actor) {
  session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
}

async function scenario() {
  const sector = await createDomainSector();
  const otherSector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const otherService = await createDomainService({ categoryId: category.id, sectorId: otherSector.id });
  const owner = await createDomainUser({ role: "REQUESTER" });
  const stranger = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const bia = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const admin = await createDomainUser({ role: "ADMIN" });

  async function add(input: {
    description: string;
    createdAt: string;
    status?: RequestStatus;
    requesterId?: string;
    assigneeId?: string;
    inOtherSector?: boolean;
  }) {
    const request = await createDomainRequest({
      requesterId: input.requesterId ?? owner.id,
      serviceId: input.inOtherSector ? otherService.id : service.id,
      sectorId: input.inOtherSector ? otherSector.id : sector.id,
    });
    // Status and its timestamps change together (Request_cancelledAt_check).
    return prisma.request.update({
      where: { id: request.id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        description: input.description,
        createdAt: new Date(input.createdAt),
        assigneeId: input.assigneeId ?? null,
        ...(input.status === "CANCELLED" ? { cancelledAt: new Date(input.createdAt) } : {}),
        ...(input.status === "COMPLETED" ? { completedAt: new Date(input.createdAt) } : {}),
      },
    });
  }

  return { sector, otherSector, service, owner, stranger, ana, bia, admin, add };
}

const descriptions = (result: { items: Array<{ description: string }> }) =>
  result.items.map(({ description }) => description);

describe("request search (SF-058)", () => {
  it("pages 25 requests by 20 in a stable order, each list with its default (CA-BUS-07, 08)", async () => {
    const { owner, ana, add } = await scenario();
    for (let index = 0; index < 25; index += 1) {
      await add({
        description: `Pedido ${String(index).padStart(2, "0")}`,
        // Two requests share each minute, so the id breaks the tie.
        createdAt: `2026-10-10T12:${String(Math.floor(index / 2)).padStart(2, "0")}:00.000Z`,
      });
    }

    actAs(owner);
    const first = await searchRequesterRequests({}, prisma);
    expect(first).toMatchObject({ total: 25, page: 1, pageCount: 2 });
    expect(first.items).toHaveLength(20);
    expect(first.criteria.order).toBe("newest");
    const second = await searchRequesterRequests({ page: "2" }, prisma);
    expect(second.items).toHaveLength(5);
    const all = [...descriptions(first), ...descriptions(second)];
    expect(new Set(all).size).toBe(25);
    expect(all[0]).toBe("Pedido 24");
    await expect(searchRequesterRequests({ page: "99" }, prisma)).resolves.toMatchObject({ page: 2 });

    actAs(ana);
    const queue = await searchAttendantQueue({}, prisma);
    expect(queue.criteria.order).toBe("oldest");
    // "Pedido 00" and "Pedido 01" share the oldest minute; the id decides between them.
    expect(["Pedido 00", "Pedido 01"]).toContain(descriptions(queue)[0]);
    const again = await searchAttendantQueue({}, prisma);
    expect(descriptions(again)).toEqual(descriptions(queue));
  });

  it("keeps each reader inside their own scope (CA-BUS-01)", async () => {
    const { owner, stranger, ana, admin, add } = await scenario();
    await add({ description: "Cadeira do dono", createdAt: "2026-10-10T12:00:00Z" });
    await add({ description: "Cadeira de outra pessoa", createdAt: "2026-10-10T12:00:00Z", requesterId: stranger.id });
    await add({ description: "Cadeira de outro setor", createdAt: "2026-10-10T12:00:00Z", inOtherSector: true });

    actAs(owner);
    expect(descriptions(await searchRequesterRequests({ q: "cadeira" }, prisma)).sort()).toEqual([
      "Cadeira de outro setor",
      "Cadeira do dono",
    ]);
    actAs(ana);
    expect(descriptions(await searchAttendantQueue({ q: "cadeira" }, prisma)).sort()).toEqual([
      "Cadeira de outra pessoa",
      "Cadeira do dono",
    ]);
    actAs(admin);
    await expect(searchRequesterRequests({}, prisma)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(searchAttendantQueue({}, prisma)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("searches description and service name without case and treats % and _ as text (CA-BUS-02)", async () => {
    const { owner, service, add } = await scenario();
    await add({ description: "Mesa BAMBA na sala 3", createdAt: "2026-10-10T12:00:00Z" });
    await add({ description: "Desconto de 100% pronto", createdAt: "2026-10-10T12:01:00Z" });
    await add({ description: "Código 1000 pronto", createdAt: "2026-10-10T12:02:00Z" });
    await add({ description: "campo nome_completo", createdAt: "2026-10-10T12:03:00Z" });
    await add({ description: "campo nomeXcompleto", createdAt: "2026-10-10T12:04:00Z" });
    actAs(owner);

    expect(descriptions(await searchRequesterRequests({ q: "bamba" }, prisma))).toEqual(["Mesa BAMBA na sala 3"]);
    expect(await searchRequesterRequests({ q: service.name.slice(0, 20).toUpperCase() }, prisma)).toMatchObject({
      total: 5,
    });
    expect(descriptions(await searchRequesterRequests({ q: "0% pronto" }, prisma))).toEqual([
      "Desconto de 100% pronto",
    ]);
    expect(descriptions(await searchRequesterRequests({ q: "nome_completo" }, prisma))).toEqual([
      "campo nome_completo",
    ]);
  });

  it("filters by status and inclusive São Paulo days (CA-BUS-04, 06)", async () => {
    const { owner, add } = await scenario();
    // 2026-10-02 00:30 in São Paulo is 03:30 UTC; 2026-10-01 23:30 in São Paulo is 02:30 UTC on the 2nd.
    await add({ description: "Fim do dia 1", createdAt: "2026-10-02T02:30:00Z" });
    await add({ description: "Início do dia 2", createdAt: "2026-10-02T03:30:00Z", status: "IN_PROGRESS" });
    await add({ description: "Fim do dia 2", createdAt: "2026-10-03T02:59:59Z", status: "CANCELLED" });
    await add({ description: "Dia 3", createdAt: "2026-10-03T03:00:00Z", status: "COMPLETED" });
    actAs(owner);

    expect(descriptions(await searchRequesterRequests({ from: "2026-10-02", to: "2026-10-02" }, prisma)).sort()).toEqual([
      "Fim do dia 2",
      "Início do dia 2",
    ]);
    expect(descriptions(await searchRequesterRequests({ to: "2026-10-01" }, prisma))).toEqual(["Fim do dia 1"]);
    expect(
      descriptions(await searchRequesterRequests({ status: ["IN_PROGRESS", "COMPLETED"] }, prisma)).sort(),
    ).toEqual(["Dia 3", "Início do dia 2"]);
    await expect(searchRequesterRequests({ status: "LOST" }, prisma)).rejects.toBeInstanceOf(ValidationError);
    await expect(searchRequesterRequests({ q: "x" }, prisma)).rejects.toBeInstanceOf(ValidationError);
  });

  it("filters the queue by effective assignee (CA-BUS-05)", async () => {
    const { ana, bia, otherSector, add } = await scenario();
    await add({ description: "Da Ana", createdAt: "2026-10-10T12:00:00Z", assigneeId: ana.id });
    await add({ description: "Da Bia", createdAt: "2026-10-10T12:01:00Z", assigneeId: bia.id });
    await add({ description: "Sem ninguém", createdAt: "2026-10-10T12:02:00Z" });
    actAs(ana);

    expect(descriptions(await searchAttendantQueue({ assignee: "mine" }, prisma))).toEqual(["Da Ana"]);
    expect(descriptions(await searchAttendantQueue({ assignee: "unassigned" }, prisma))).toEqual(["Sem ninguém"]);

    await prisma.user.update({ where: { id: bia.id }, data: { sectorId: otherSector.id } });
    expect(descriptions(await searchAttendantQueue({ assignee: "unassigned" }, prisma))).toEqual([
      "Da Bia",
      "Sem ninguém",
    ]);
    await prisma.user.update({ where: { id: bia.id }, data: { sectorId: null, role: "REQUESTER" } });
    expect(await searchAttendantQueue({ assignee: "unassigned" }, prisma)).toMatchObject({ total: 2 });
  });
});
