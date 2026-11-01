import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { AuthenticationError, ConflictError, NotFoundError } from "@/server/errors";
import { createDomainCategory, createDomainSector, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { runOutbox } from "@/modules/events";
import { notificationConsumer } from "@/modules/notifications";
import { createService } from "@/modules/services";
import {
  changeRequestPriority,
  createRequest,
  decideApproval,
  getRequesterRequest,
  transitionRequestStatus,
} from "@/modules/requests";

// SPEC 2026-11-01-aprovacoes, sections 5.3 to 5.6 (SF-084; CA-APR-05 to 08).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const HOUR = 60 * 60 * 1000;

function actAs(actor: Actor) {
  session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
}

async function scenario() {
  const sector = await createDomainSector();
  const otherSector = await createDomainSector();
  const category = await createDomainCategory();
  const admin = await createDomainUser({ role: "ADMIN" });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const gabi = await createDomainUser({ role: "MANAGER", sectorId: sector.id });
  const hugo = await createDomainUser({ role: "MANAGER", sectorId: sector.id });
  const inactiveManager = await createDomainUser({ role: "MANAGER", sectorId: sector.id, isActive: false });
  const otto = await createDomainUser({ role: "MANAGER", sectorId: otherSector.id });
  actAs(admin);
  const service = await createService(
    { name: `Compra ${sector.id}`, description: "Compra", categoryId: category.id, sectorId: sector.id, slaHours: "10", requiresApproval: true },
    prisma,
  );
  actAs(rita);
  const request = await createRequest({ serviceId: service.id, description: "Notebook" }, prisma);
  return { rita, ana, gabi, hugo, inactiveManager, otto, admin, request };
}

const stored = (id: string) => prisma.request.findUniqueOrThrow({ where: { id } });
const process = () => runOutbox([notificationConsumer(prisma)], { maxBatches: 5 }, prisma);
const notificationsOf = (recipientId: string) =>
  prisma.requestNotification.findMany({ where: { recipientId }, orderBy: { createdAt: "asc" }, select: { type: true } });

describe("manager decision (SF-084)", () => {
  it("approves, starts the SLA from the approval and lets the attendance begin (CA-APR-05, 07)", async () => {
    const { ana, gabi, request } = await scenario();
    actAs(gabi);

    await decideApproval({ requestId: request.id, decision: "APPROVED" }, prisma);

    const approved = await stored(request.id);
    const record = await prisma.requestApproval.findUniqueOrThrow({ where: { requestId: request.id } });
    expect(approved).toMatchObject({ status: "OPEN", approvalState: "APPROVED" });
    expect(approved.dueAt!.getTime() - record.decidedAt.getTime()).toBe(10 * HOUR);
    expect(approved.dueSoonAt).not.toBeNull();
    expect(record).toMatchObject({ deciderId: gabi.id, decision: "APPROVED", note: null });

    actAs(ana);
    await expect(
      transitionRequestStatus({ requestId: request.id, toStatus: "IN_PROGRESS" }, prisma),
    ).resolves.toMatchObject({ status: "IN_PROGRESS" });
  });

  it("rejects with a note, cancelling the request with the note in the history (CA-APR-06, 08)", async () => {
    const { rita, gabi, request } = await scenario();
    actAs(gabi);

    await decideApproval({ requestId: request.id, decision: "REJECTED", note: "Fora do orçamento" }, prisma);

    await expect(stored(request.id)).resolves.toMatchObject({ status: "CANCELLED", approvalState: "REJECTED", dueAt: null });
    actAs(rita);
    const detail = await getRequesterRequest(request.id, prisma);
    expect(detail.approval).toMatchObject({ decision: "REJECTED", note: "Fora do orçamento", decider: { id: gabi.id } });
    expect(detail.events.at(-1)).toMatchObject({ toStatus: "CANCELLED", note: "Fora do orçamento", actorId: gabi.id });
  });

  it("counts only one of two simultaneous decisions (CA-APR-06)", async () => {
    const { gabi, hugo, request } = await scenario();

    actAs(gabi);
    const first = decideApproval({ requestId: request.id, decision: "APPROVED" }, prisma);
    actAs(hugo);
    const second = decideApproval({ requestId: request.id, decision: "REJECTED", note: "Não" }, prisma);
    const results = await Promise.allSettled([first, second]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    await expect(prisma.requestApproval.count({ where: { requestId: request.id } })).resolves.toBe(1);
    const final = await stored(request.id);
    const record = await prisma.requestApproval.findUniqueOrThrow({ where: { requestId: request.id } });
    expect(final.approvalState).toBe(record.decision);
  });

  it("refuses outsiders and a second decision (CA-APR-06)", async () => {
    const { ana, rita, admin, otto, inactiveManager, gabi, request } = await scenario();

    for (const outsider of [otto, ana, rita, admin]) {
      actAs(outsider);
      await expect(decideApproval({ requestId: request.id, decision: "APPROVED" }, prisma)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    }
    // An inactive user does not even get past the session check.
    actAs(inactiveManager);
    await expect(decideApproval({ requestId: request.id, decision: "APPROVED" }, prisma)).rejects.toBeInstanceOf(
      AuthenticationError,
    );
    await expect(stored(request.id)).resolves.toMatchObject({ approvalState: "PENDING" });
    actAs(gabi);
    await decideApproval({ requestId: request.id, decision: "APPROVED" }, prisma);
    await expect(
      decideApproval({ requestId: request.id, decision: "REJECTED", note: "Não" }, prisma),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("keeps a pending request without a due date when the priority changes", async () => {
    const { ana, request } = await scenario();
    actAs(ana);

    await changeRequestPriority({ requestId: request.id, priority: "URGENT" }, prisma);

    await expect(stored(request.id)).resolves.toMatchObject({ priority: "URGENT", dueAt: null });
  });

  it("notifies the active sector managers on opening and the requester of the decision (CA-APR-08)", async () => {
    const { rita, gabi, hugo, inactiveManager, otto, request } = await scenario();
    await process();

    for (const manager of [gabi, hugo]) {
      await expect(notificationsOf(manager.id)).resolves.toEqual([{ type: "approval.requested" }]);
    }
    for (const outsider of [inactiveManager, otto]) {
      await expect(notificationsOf(outsider.id)).resolves.toEqual([]);
    }

    actAs(gabi);
    await decideApproval({ requestId: request.id, decision: "REJECTED", note: "Fora do orçamento" }, prisma);
    await process();

    // One notification for the rejection, not a second one for the cancellation it caused.
    await expect(notificationsOf(rita.id)).resolves.toEqual([{ type: "approval.rejected" }]);
  });

  it("notifies the requester of an approval", async () => {
    const { rita, gabi, request } = await scenario();
    actAs(gabi);
    await decideApproval({ requestId: request.id, decision: "APPROVED", note: "Pode seguir" }, prisma);
    await process();

    await expect(notificationsOf(rita.id)).resolves.toEqual([{ type: "approval.approved" }]);
  });
});
