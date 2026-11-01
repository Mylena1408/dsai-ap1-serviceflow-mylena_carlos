import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { AuthorizationError, ConflictError, NotFoundError } from "@/server/errors";
import { createDomainCategory, createDomainSector, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-01-permissoes-configuraveis, sections 5.3.2 and 5.3.3 (SF-090; CA-PER-06, 07 and 08).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { runOutbox } from "@/modules/events";
import { notificationConsumer } from "@/modules/notifications";
import { grantPermission, revokePermission } from "@/modules/permissions";
import { createService } from "@/modules/services";
import {
  assumeRequest,
  createRequest,
  decideApproval,
  getManagerRequest,
  listManagerApprovals,
  listRequestAttachments,
  listRequestFieldAnswers,
  releaseRequest,
  transferRequest,
} from "@/modules/requests";

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };

function actAs(actor: Actor) {
  session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
}

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const admin = await createDomainUser({ role: "ADMIN" });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const bia = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const caio = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const gabi = await createDomainUser({ role: "MANAGER", sectorId: sector.id });
  actAs(admin);
  const base = { description: "Serviço", categoryId: category.id, sectorId: sector.id };
  const plainService = await createService({ name: `Troca ${sector.id}`, ...base }, prisma);
  const approvalService = await createService({ name: `Compra ${sector.id}`, ...base, requiresApproval: true }, prisma);
  actAs(rita);
  const plain = await createRequest({ serviceId: plainService.id, description: "Teclado" }, prisma);
  const withApproval = await createRequest({ serviceId: approvalService.id, description: "Notebook" }, prisma);
  return { admin, rita, ana, bia, caio, gabi, plain, withApproval };
}

const assigneeOf = async (id: string) => (await prisma.request.findUniqueOrThrow({ where: { id } })).assigneeId;

describe("wider read for managers (SF-090; CA-PER-06)", () => {
  it("lists and opens every request of the sector only with the permission", async () => {
    const { admin, gabi, plain, withApproval } = await scenario();

    actAs(gabi);
    await expect(listManagerApprovals("sector", prisma)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(getManagerRequest(plain.id, prisma)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listRequestFieldAnswers(plain.id, prisma)).rejects.toBeInstanceOf(NotFoundError);

    actAs(admin);
    await grantPermission({ userId: gabi.id, permission: "SECTOR_REQUESTS_READ" }, prisma);
    actAs(gabi);
    const ids = (await listManagerApprovals("sector", prisma)).map(({ id }) => id);
    expect(ids).toEqual(expect.arrayContaining([plain.id, withApproval.id]));
    await expect(getManagerRequest(plain.id, prisma)).resolves.toMatchObject({ id: plain.id, approvalState: null });
    await expect(listRequestFieldAnswers(plain.id, prisma)).resolves.toEqual([]);
    await expect(listRequestAttachments(plain.id, prisma)).resolves.toEqual([]);
    // Reading more does not decide more: only requests that require approval are decided.
    await expect(decideApproval({ requestId: plain.id, decision: "APPROVED" }, prisma)).rejects.toBeInstanceOf(NotFoundError);

    actAs(admin);
    await revokePermission({ userId: gabi.id, permission: "SECTOR_REQUESTS_READ" }, prisma);
    actAs(gabi);
    await expect(getManagerRequest(plain.id, prisma)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("queue supervision (SF-090; CA-PER-07, 08)", () => {
  it("releases and transfers a colleague's request only with the permission", async () => {
    const { admin, ana, bia, caio, plain } = await scenario();
    actAs(ana);
    await assumeRequest({ requestId: plain.id }, prisma);

    actAs(bia);
    await expect(releaseRequest({ requestId: plain.id }, prisma)).rejects.toBeInstanceOf(ConflictError);

    actAs(admin);
    await grantPermission({ userId: bia.id, permission: "QUEUE_SUPERVISION" }, prisma);
    actAs(bia);
    await transferRequest({ requestId: plain.id, assigneeId: caio.id }, prisma);
    expect(await assigneeOf(plain.id)).toBe(caio.id);
    await releaseRequest({ requestId: plain.id }, prisma);
    expect(await assigneeOf(plain.id)).toBeNull();

    const events = await prisma.requestAssignmentEvent.findMany({ where: { requestId: plain.id }, orderBy: { occurredAt: "asc" } });
    expect(events.map(({ actorId, fromAssigneeId, toAssigneeId }) => [actorId, fromAssigneeId, toAssigneeId])).toEqual([
      [ana.id, null, ana.id],
      [bia.id, ana.id, caio.id],
      [bia.id, caio.id, null],
    ]);

    // The existing notification of a transfer reaches the new holder.
    await runOutbox([notificationConsumer(prisma)], { maxBatches: 5 }, prisma);
    await expect(
      prisma.requestNotification.count({ where: { recipientId: caio.id, type: "assignment.received" } }),
    ).resolves.toBe(1);
  });

  it("stops at once after a revocation", async () => {
    const { admin, ana, bia, plain } = await scenario();
    actAs(ana);
    await assumeRequest({ requestId: plain.id }, prisma);
    actAs(admin);
    await grantPermission({ userId: bia.id, permission: "QUEUE_SUPERVISION" }, prisma);
    await revokePermission({ userId: bia.id, permission: "QUEUE_SUPERVISION" }, prisma);

    actAs(bia);
    await expect(releaseRequest({ requestId: plain.id }, prisma)).rejects.toBeInstanceOf(ConflictError);
    expect(await assigneeOf(plain.id)).toBe(ana.id);
  });
});
