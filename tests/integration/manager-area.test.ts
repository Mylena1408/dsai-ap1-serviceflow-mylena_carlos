import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { AuthorizationError, NotFoundError } from "@/server/errors";
import { createDomainCategory, createDomainSector, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { createService } from "@/modules/services";
import {
  createRequest,
  decideApproval,
  getManagerRequest,
  listManagerApprovals,
  listRequestAttachments,
  listRequestFieldAnswers,
} from "@/modules/requests";

// SPEC 2026-11-01-aprovacoes, sections 5.7 and 5.8 (SF-085; CA-APR-09).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };

function actAs(actor: Actor) {
  session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
}

async function scenario() {
  const sector = await createDomainSector();
  const otherSector = await createDomainSector();
  const category = await createDomainCategory();
  const admin = await createDomainUser({ role: "ADMIN" });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const gabi = await createDomainUser({ role: "MANAGER", sectorId: sector.id });
  const otto = await createDomainUser({ role: "MANAGER", sectorId: otherSector.id });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  actAs(admin);
  const base = { description: "Serviço", categoryId: category.id, sectorId: sector.id };
  const approvalService = await createService({ name: `Compra ${sector.id}`, ...base, requiresApproval: true }, prisma);
  const plainService = await createService({ name: `Troca ${sector.id}`, ...base }, prisma);
  actAs(rita);
  const first = await createRequest({ serviceId: approvalService.id, description: "Notebook" }, prisma);
  const second = await createRequest({ serviceId: approvalService.id, description: "Monitor" }, prisma);
  const plain = await createRequest({ serviceId: plainService.id, description: "Teclado" }, prisma);
  return { rita, gabi, otto, ana, first, second, plain };
}

describe("manager area (SF-085)", () => {
  it("lists pending approvals of the sector by default and every decided one with 'all' (CA-APR-09)", async () => {
    const { gabi, first, second, plain } = await scenario();
    actAs(gabi);
    await decideApproval({ requestId: first.id, decision: "APPROVED" }, prisma);

    expect((await listManagerApprovals("pending", prisma)).map(({ id }) => id)).toEqual([second.id]);
    const all = (await listManagerApprovals("all", prisma)).map(({ id }) => id);
    expect(all).toEqual([second.id, first.id]); // pending first
    expect(all).not.toContain(plain.id);
  });

  it("opens only requests of the sector that require approval, read-only (CA-APR-09)", async () => {
    const { gabi, otto, first, plain } = await scenario();
    actAs(gabi);

    await expect(getManagerRequest(first.id, prisma)).resolves.toMatchObject({ id: first.id, approvalState: "PENDING" });
    await expect(getManagerRequest(plain.id, prisma)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listRequestFieldAnswers(first.id, prisma)).resolves.toEqual([]);
    await expect(listRequestAttachments(first.id, prisma)).resolves.toEqual([]);
    await expect(listRequestAttachments(plain.id, prisma)).rejects.toBeInstanceOf(NotFoundError);

    actAs(otto);
    await expect(getManagerRequest(first.id, prisma)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listManagerApprovals("all", prisma)).resolves.toEqual([]);
    await expect(listRequestFieldAnswers(first.id, prisma)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("keeps the manager area to managers", async () => {
    const { rita, ana } = await scenario();

    for (const actor of [rita, ana]) {
      actAs(actor);
      await expect(listManagerApprovals("pending", prisma)).rejects.toBeInstanceOf(AuthorizationError);
    }
  });
});
