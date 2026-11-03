import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainSector, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { runOutbox } from "@/modules/events";
import { notificationConsumer } from "@/modules/notifications";
import { addComment } from "@/modules/comments";
import {
  addLateDocument,
  assumeRequest,
  createRequest,
  getRequesterRequest,
  pauseRequestSla,
  recordSlaAlerts,
  resumeRequestSla,
  searchAttendantQueue,
  transitionRequestStatus,
} from "@/modules/requests";
import { createPrismaDashboardReader } from "@/modules/reports/infrastructure/prisma-dashboard-reader";
import { createService } from "@/modules/services";
import { anonymizeUser } from "@/modules/users";
import { createMemoryDocumentStorage } from "@/server/storage";
import { ConflictError } from "@/server/errors";
import { GET as downloadPersonalData } from "@/app/api/account/data/route";
import { minimalPdf } from "../unit/modules/attachments/synthetic-files";

// SPEC 2026-11-03-pausa-sla-calendario, 5.3 to 5.9 over the database (SF-130; CA-PSL-05 to 08 and 10).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const HOUR = 60 * 60 * 1000;

function actAs(actor: Actor) {
  session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
}

const stored = (id: string) => prisma.request.findUniqueOrThrow({ where: { id } });

/** Moves the running pause back in time, as if it had started `ms` earlier. */
async function backdatePause(requestId: string, ms: number) {
  const request = await stored(requestId);
  const pausedAt = new Date(request.slaPausedAt!.getTime() - ms);
  await prisma.request.update({ where: { id: requestId }, data: { slaPausedAt: pausedAt } });
  await prisma.requestSlaPause.updateMany({ where: { requestId, resumedAt: null }, data: { pausedAt } });
  return pausedAt;
}

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const admin = await createDomainUser({ role: "ADMIN" });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const bia = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  actAs(admin);
  const service = await createService(
    { name: `Reparo ${sector.id}`, description: "Conserto", categoryId: category.id, sectorId: sector.id, slaHours: "10" },
    prisma,
  );
  actAs(rita);
  const request = await createRequest({ serviceId: service.id, description: "Tomada solta" }, prisma);
  actAs(ana);
  await assumeRequest({ requestId: request.id }, prisma);
  await transitionRequestStatus({ requestId: request.id, toStatus: "IN_PROGRESS" }, prisma);
  return { sector, admin, rita, ana, bia, request };
}

describe("SLA pause over the database (SF-130)", () => {
  it("pauses, notifies the requester, leaves alerts and filters aside and resumes on the requester's comment", async () => {
    const { sector, rita, ana, request } = await scenario();
    const before = await stored(request.id);

    actAs(ana);
    await pauseRequestSla({ requestId: request.id, reason: "Qual é o número do patrimônio?" }, prisma);
    const paused = await stored(request.id);
    expect(paused).toMatchObject({ status: "IN_PROGRESS", assigneeId: ana.id, dueAt: before.dueAt });
    expect(paused.slaPausedAt).not.toBeNull();
    await expect(pauseRequestSla({ requestId: request.id, reason: "De novo" }, prisma)).rejects.toThrow(ConflictError);

    // The requester is asked to reply (CA-PSL-08).
    await runOutbox([notificationConsumer(prisma)], { maxBatches: 5 }, prisma);
    await expect(
      prisma.requestNotification.findMany({ where: { requestId: request.id, type: "sla.paused" }, select: { recipientId: true } }),
    ).resolves.toEqual([{ recipientId: rita.id }]);

    // "Paused" in the filter and the dashboard, never "overdue"; no alert even far in the future (CA-PSL-06).
    const future = new Date(before.dueAt!.getTime() + 24 * HOUR);
    const ids = async (sla: string) => (await searchAttendantQueue({ sla })).items.map(({ id }) => id);
    await expect(ids("paused")).resolves.toEqual([request.id]);
    await expect(ids("on_time")).resolves.toEqual([]);
    await expect(createPrismaDashboardReader(prisma).currentCounts({ sectorId: sector.id }, future)).resolves.toMatchObject({
      paused: 1,
      dueSoon: 0,
      overdue: 0,
    });
    await recordSlaAlerts(future, prisma);
    await expect(prisma.outboxEvent.count({ where: { requestId: request.id, type: { in: ["request.sla_warning", "request.sla_breached"] } } })).resolves.toBe(0);

    // The requester sees the reason, then replies: the SLA resumes with the paused time added (CA-PSL-07).
    actAs(rita);
    const own = await getRequesterRequest(request.id, prisma);
    expect(own.slaPauses?.map(({ reason }) => reason)).toEqual(["Qual é o número do patrimônio?"]);
    const pausedAt = await backdatePause(request.id, HOUR);
    await addComment({ requestId: request.id, body: "Patrimônio 4521", isInternal: false }, prisma);

    const resumed = await stored(request.id);
    const pause = await prisma.requestSlaPause.findFirstOrThrow({ where: { requestId: request.id } });
    expect(resumed.slaPausedAt).toBeNull();
    expect(pause).toMatchObject({ resumedById: rita.id, resumeCause: "REQUESTER_REPLY" });
    expect(resumed.dueAt!.getTime() - before.dueAt!.getTime()).toBe(pause.resumedAt!.getTime() - pausedAt.getTime());
    await expect(prisma.outboxEvent.count({ where: { requestId: request.id, type: "request.sla_resumed" } })).resolves.toBe(1);
  });

  it("keeps the pause on an internal note and ends it on a manual resume and on completion (CA-PSL-07)", async () => {
    const { ana, bia, request } = await scenario();
    actAs(ana);
    await pauseRequestSla({ requestId: request.id, reason: "Aguardando foto" }, prisma);

    await addComment({ requestId: request.id, body: "Lembrar de cobrar", isInternal: true }, prisma);
    await expect(stored(request.id)).resolves.not.toMatchObject({ slaPausedAt: null });

    // A colleague without supervision cannot resume; the holder can.
    actAs(bia);
    await expect(resumeRequestSla({ requestId: request.id }, prisma)).rejects.toThrow(ConflictError);
    actAs(ana);
    await resumeRequestSla({ requestId: request.id }, prisma);
    await expect(stored(request.id)).resolves.toMatchObject({ slaPausedAt: null });

    // Paused with an hour left, completed two hours after the original due date: on time.
    await pauseRequestSla({ requestId: request.id, reason: "Aguardando foto de novo" }, prisma);
    const current = await stored(request.id);
    const shift = current.dueAt!.getTime() - current.slaPausedAt!.getTime() - HOUR;
    await backdatePause(request.id, shift + 2 * HOUR);
    await transitionRequestStatus({ requestId: request.id, toStatus: "COMPLETED" }, prisma);

    await expect(stored(request.id)).resolves.toMatchObject({ status: "COMPLETED", slaPausedAt: null, completedLate: false });
    const pauses = await prisma.requestSlaPause.findMany({ where: { requestId: request.id }, orderBy: { resumedAt: "asc" } });
    expect(pauses.map(({ resumeCause, resumedById }) => [resumeCause, resumedById])).toEqual([
      ["MANUAL", ana.id],
      ["ATTENDANCE_ENDED", ana.id],
    ]);
  });

  it("resumes when the requester sends a missing document (CA-PSL-07)", async () => {
    const { rita, ana, request } = await scenario();
    const requirement = await prisma.serviceDocumentRequirement.create({
      data: { serviceId: request.serviceId, name: "Foto", isRequired: false, acceptedFormats: ["PDF"], position: 0 },
    });
    actAs(ana);
    await pauseRequestSla({ requestId: request.id, reason: "Envie a foto" }, prisma);

    actAs(rita);
    await addLateDocument(
      { requestId: request.id, requirementId: requirement.id, file: { name: "foto.pdf", bytes: minimalPdf() } },
      prisma,
      createMemoryDocumentStorage(),
    );

    await expect(stored(request.id)).resolves.toMatchObject({ slaPausedAt: null });
    await expect(prisma.requestSlaPause.findFirstOrThrow({ where: { requestId: request.id } })).resolves.toMatchObject({
      resumedById: rita.id,
      resumeCause: "REQUESTER_REPLY",
    });
  });

  it("puts the pauses in the requester's data and removes the reason on anonymization (CA-PSL-10)", async () => {
    const { admin, rita, ana, request } = await scenario();
    actAs(ana);
    await pauseRequestSla({ requestId: request.id, reason: "Falta a nota fiscal" }, prisma);
    await resumeRequestSla({ requestId: request.id }, prisma);

    actAs(rita);
    const file = JSON.parse(await (await downloadPersonalData()).text());
    expect(file.solicitacoesQueVoceAbriu[0].pausas).toEqual([
      expect.objectContaining({ por: ana.name, motivo: "Falta a nota fiscal", retomada: "pela equipe" }),
    ]);

    actAs(ana);
    await transitionRequestStatus({ requestId: request.id, toStatus: "COMPLETED" }, prisma);
    await prisma.user.update({ where: { id: ana.id }, data: { isActive: false } });
    actAs(admin);
    await anonymizeUser({ userId: ana.id, confirmed: true }, prisma, createMemoryDocumentStorage());
    await expect(prisma.requestSlaPause.findFirstOrThrow({ where: { requestId: request.id } })).resolves.toMatchObject({
      reason: "[conteúdo removido na anonimização]",
    });
  });
});
