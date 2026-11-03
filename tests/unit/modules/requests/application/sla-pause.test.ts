import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import {
  createInMemoryTransactionRunner,
  createStore,
  fixedNow,
  requestId,
  storedRequest,
  type InMemoryRequestStore,
  type StoredActor,
} from "../in-memory-requests";

const authorization = vi.hoisted(() => ({ requireStatusChangeActor: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import { pauseRequestSla, resumeOnRequesterReply, resumeRequestSla } from "@/modules/requests/application/sla-pause";
import { transitionRequestStatus } from "@/modules/requests/application/transition-request-status";
import { plannedNotifications } from "@/modules/notifications/domain/recipients";
import { notificationCategory } from "@/modules/notifications/domain/email";
import { notificationMessage } from "@/shared/notifications";
import { buildTimeline } from "@/app/_components/request-timeline";
import type { RequestWithHistory } from "@/modules/requests";

// SPEC 2026-11-03-pausa-sla-calendario, 5.3 to 5.6 (SF-130; CA-PSL-05, 07 and 08).

const MINUTE = 60_000;
const attendant = (id: string, sectorId = "sector-1"): StoredActor => ({
  id,
  role: "ATTENDANT",
  sectorId,
  isActive: true,
  name: id,
  email: `${id}@example.test`,
});
const ana = attendant("ana");
const bia = attendant("bia");
const caio = attendant("caio", "sector-2");
const opened = new Date(fixedNow.getTime() - 60 * MINUTE);
const due = new Date(opened.getTime() + 600 * MINUTE);

function scenario(overrides: Parameters<typeof storedRequest>[0] = {}): InMemoryRequestStore {
  return createStore({
    actors: [ana, bia, caio],
    requests: [
      storedRequest({
        createdAt: opened,
        status: "IN_PROGRESS",
        assigneeId: "ana",
        priority: "NORMAL",
        slaHoursSnapshot: 10,
        dueAt: due,
        ...overrides,
      }),
    ],
  });
}

function actAs(actor: StoredActor) {
  authorization.requireStatusChangeActor.mockResolvedValue({ actorId: actor.id, sectorId: actor.sectorId });
}

const pause = (store: InMemoryRequestStore, reason = "Falta o número do patrimônio") =>
  pauseRequestSla({ requestId, reason }, createInMemoryTransactionRunner(store));

describe("pausing the SLA (5.3)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("pauses with a reason, keeping status, assignee and due date, and records the event (CA-PSL-05)", async () => {
    const store = scenario();
    actAs(ana);

    await pause(store, "  Falta o número do patrimônio  ");

    expect(store.requests[0]).toMatchObject({ status: "IN_PROGRESS", assigneeId: "ana", dueAt: due, slaPausedAt: fixedNow });
    expect(store.slaPauses).toEqual([
      { id: "pause-1", requestId, pausedById: "ana", reason: "Falta o número do patrimônio", pausedAt: fixedNow },
    ]);
    expect(store.outbox).toEqual([
      { type: "request.sla_paused", requestId, occurredAt: fixedNow, payload: { pauseId: "pause-1", actorId: "ana" } },
    ]);
  });

  it("refuses with the codes of the rules and writes nothing (CA-PSL-05)", async () => {
    const cases: Array<[StoredActor, Parameters<typeof storedRequest>[0], string, new (...args: never[]) => Error]> = [
      [ana, {}, "", ValidationError],
      [ana, {}, "x".repeat(501), ValidationError],
      [ana, { status: "OPEN" }, "Motivo", ConflictError],
      [ana, { status: "COMPLETED" }, "Motivo", ConflictError],
      [ana, { slaHoursSnapshot: null, dueAt: null }, "Motivo", ConflictError],
      [ana, { slaPausedAt: opened }, "Motivo", ConflictError],
      // Overdue (decision H7).
      [ana, { dueAt: new Date(fixedNow.getTime() - 1) }, "Motivo", ConflictError],
      // A colleague without supervision, and someone from another sector.
      [bia, {}, "Motivo", ConflictError],
      [caio, {}, "Motivo", NotFoundError],
    ];

    for (const [actor, overrides, reason, error] of cases) {
      const store = scenario(overrides);
      actAs(actor);
      await expect(pause(store, reason), `${actor.id} ${JSON.stringify(overrides)}`).rejects.toThrow(error);
      expect(store.slaPauses ?? []).toEqual([]);
      expect(store.outbox).toEqual([]);
    }
  });

  it("lets any attendant of the sector act when nobody holds the request (released)", async () => {
    const store = scenario({ assigneeId: null });
    actAs(bia);

    await pause(store);
    await resumeRequestSla({ requestId }, createInMemoryTransactionRunner(store));

    expect(store.slaPauses?.[0]).toMatchObject({ resumedById: "bia", resumeCause: "MANUAL" });
  });
});

describe("resuming the SLA (5.4)", () => {
  beforeEach(() => vi.clearAllMocks());

  function paused(minutesAgo: number) {
    const pausedAt = new Date(fixedNow.getTime() - minutesAgo * MINUTE);
    const store = scenario({ slaPausedAt: pausedAt });
    store.slaPauses = [{ id: "pause-1", requestId, pausedById: "ana", reason: "Falta o patrimônio", pausedAt }];
    return store;
  }

  it("moves the due date by the length of the pause on a manual resume (CA-PSL-07)", async () => {
    const store = paused(45);
    actAs(ana);

    await resumeRequestSla({ requestId }, createInMemoryTransactionRunner(store));

    expect(store.requests[0]).toMatchObject({ slaPausedAt: null, dueAt: new Date(due.getTime() + 45 * MINUTE) });
    expect(store.slaPauses?.[0]).toMatchObject({ resumedAt: fixedNow, resumedById: "ana", resumeCause: "MANUAL" });
    expect(store.outbox).toEqual([
      {
        type: "request.sla_resumed",
        requestId,
        occurredAt: fixedNow,
        payload: { pauseId: "pause-1", actorId: "ana", cause: "manual" },
      },
    ]);

    actAs(ana);
    await expect(resumeRequestSla({ requestId }, createInMemoryTransactionRunner(store))).rejects.toThrow(ConflictError);
  });

  it("resumes on a reply of the requester only, and does nothing otherwise (CA-PSL-07)", async () => {
    const store = paused(30);
    const runner = createInMemoryTransactionRunner(store);

    await expect(runner.run((transaction) => resumeOnRequesterReply(transaction, requestId, "ana"))).resolves.toBe(false);
    await expect(runner.run((transaction) => resumeOnRequesterReply(transaction, requestId, "requester-1"))).resolves.toBe(true);
    expect(store.slaPauses?.[0]).toMatchObject({ resumedById: "requester-1", resumeCause: "REQUESTER_REPLY" });
    expect(store.requests[0]?.dueAt).toEqual(new Date(due.getTime() + 30 * MINUTE));
    // Not paused any more: a second reply changes nothing.
    await expect(runner.run((transaction) => resumeOnRequesterReply(transaction, requestId, "requester-1"))).resolves.toBe(false);
  });

  it("ends the pause on completion, so the paused time does not make it late (CA-PSL-07)", async () => {
    // Paused 2 hours ago with 8 hours left; completed now, 1 hour past the original due date.
    const late = new Date(fixedNow.getTime() - 60 * MINUTE);
    const pausedAt = new Date(fixedNow.getTime() - 120 * MINUTE);
    const store = scenario({ dueAt: late, slaPausedAt: pausedAt });
    store.slaPauses = [{ id: "pause-1", requestId, pausedById: "ana", reason: "Falta o patrimônio", pausedAt }];
    actAs(ana);

    await transitionRequestStatus({ requestId, toStatus: "COMPLETED" }, createInMemoryTransactionRunner(store));

    expect(store.requests[0]).toMatchObject({ status: "COMPLETED", slaPausedAt: null, completedLate: false });
    expect(store.requests[0]?.dueAt).toEqual(new Date(late.getTime() + 120 * MINUTE));
    expect(store.slaPauses?.[0]).toMatchObject({ resumedById: "ana", resumeCause: "ATTENDANCE_ENDED" });
    expect(store.outbox.map(({ type }) => type)).toEqual(["request.status_changed", "request.sla_resumed"]);
  });
});

describe("notification and history of a pause (5.5 and 5.6)", () => {
  it("asks the requester to reply, in the status category; the resume notifies nobody", () => {
    expect(plannedNotifications({ type: "request.sla_paused", payload: { actorId: "ana" } }, { requesterId: "rita", effectiveAssigneeId: "ana" })).toEqual([
      { recipientId: "rita", type: "sla.paused" },
    ]);
    expect(
      plannedNotifications({ type: "request.sla_resumed" } as never, { requesterId: "rita", effectiveAssigneeId: "ana" }),
    ).toEqual([]);
    expect(notificationCategory("sla.paused")).toBe("STATUS");
    expect(notificationMessage({ type: "sla.paused", serviceName: "Reparo" })).toBe("Aguardando sua resposta: Reparo");
  });

  it("shows the pause with its reason and each resume with its cause", () => {
    const at = (minutes: number) => new Date(opened.getTime() + minutes * MINUTE);
    const pauseOf = (id: string, resumeCause: "MANUAL" | "REQUESTER_REPLY" | "ATTENDANCE_ENDED" | null, resumedBy: { id: string; name: string } | null) => ({
      id,
      requestId,
      pausedById: "ana",
      reason: `Motivo ${id}`,
      pausedAt: at(Number(id) * 10),
      resumedAt: resumeCause ? at(Number(id) * 10 + 5) : null,
      resumedById: resumedBy?.id ?? null,
      resumeCause,
      pausedBy: { id: "ana", name: "Ana" },
      resumedBy,
    });
    const request = {
      createdAt: opened,
      events: [],
      assignmentEvents: [],
      priorityEvents: [],
      stageEvents: [],
      slaPauses: [
        pauseOf("1", "MANUAL", { id: "ana", name: "Ana" }),
        pauseOf("2", "REQUESTER_REPLY", { id: "rita", name: "Rita" }),
        pauseOf("3", "ATTENDANCE_ENDED", { id: "ana", name: "Ana" }),
        pauseOf("4", null, null),
      ],
    } as unknown as RequestWithHistory;

    expect(buildTimeline(request).map(({ title, note }) => [title, note])).toEqual([
      ["Prazo pausado: aguardando o solicitante", "Motivo 1"],
      ["Prazo retomado por Ana", null],
      ["Prazo pausado: aguardando o solicitante", "Motivo 2"],
      ["Prazo retomado pela resposta do solicitante", null],
      ["Prazo pausado: aguardando o solicitante", "Motivo 3"],
      ["Prazo retomado com o fim do atendimento", null],
      ["Prazo pausado: aguardando o solicitante", "Motivo 4"],
    ]);
  });
});
