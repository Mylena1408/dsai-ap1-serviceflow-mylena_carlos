import { describe, expect, it } from "vitest";
import { buildTimeline } from "@/app/_components/request-timeline";
import type { RequestWithHistory } from "@/modules/requests";

// SPEC 2026-10-31, section 5.9 (CA-ATR-12), SF-052.

const at = (minute: number) => new Date(`2026-10-31T12:${String(minute).padStart(2, "0")}:00.000Z`);
const ana = { id: "ana", name: "Ana" };
const bia = { id: "bia", name: "Bia" };
const rita = { id: "rita", name: "Rita" };

function statusEvent(id: string, minute: number, fromStatus: RequestWithHistory["status"] | null, toStatus: RequestWithHistory["status"], actor = rita, note: string | null = null) {
  return { id, requestId: "r", actorId: actor.id, fromStatus, toStatus, occurredAt: at(minute), note, actor: { ...actor, email: "x@example.test" } };
}

function assignmentEvent(id: string, minute: number, from: typeof ana | null, to: typeof ana | null, actor = ana) {
  return {
    id,
    requestId: "r",
    actorId: actor.id,
    fromAssigneeId: from?.id ?? null,
    toAssigneeId: to?.id ?? null,
    occurredAt: at(minute),
    actor,
    fromAssignee: from,
    toAssignee: to,
  };
}

const request = {
  // Stage moves (SPEC 2026-11-01-fluxos-configuraveis) are covered in request-stage-timeline.test.ts.
  stageEvents: [],
  priorityEvents: [
    { id: "p1", requestId: "r", actorId: "bia", fromPriority: "NORMAL", toPriority: "URGENT", occurredAt: at(3), actor: bia },
  ],
  events: [
    statusEvent("s1", 0, null, "OPEN"),
    statusEvent("s2", 3, "OPEN", "IN_PROGRESS", bia),
    statusEvent("s3", 4, "IN_PROGRESS", "COMPLETED", bia),
    statusEvent("s4", 5, "COMPLETED", "OPEN", rita, "A impressora parou de novo"),
  ],
  assignmentEvents: [
    assignmentEvent("a1", 1, null, ana),
    assignmentEvent("a2", 2, ana, bia),
    assignmentEvent("a3", 6, bia, null, bia),
  ],
} as unknown as RequestWithHistory;

describe("request timeline", () => {
  it("merges status and assignment events in chronological order with reasons (CA-ATR-12)", () => {
    expect(buildTimeline(request).map(({ title, actor, note }) => [title, actor, note])).toEqual([
      ["Solicitação aberta: Aberta", "Rita", null],
      ["Assumida por Ana", "Ana", null],
      ["Transferida de Ana para Bia", "Ana", null],
      ["Aberta → Em atendimento", "Bia", null],
      ["Prioridade: Normal → Urgente", "Bia", null],
      ["Em atendimento → Concluída", "Bia", null],
      ["Concluída → Aberta", "Rita", "A impressora parou de novo"],
      ["Liberada por Bia", "Bia", null],
    ]);
  });

  it("keeps status events first when times are equal", () => {
    const tied = {
      stageEvents: [],
      priorityEvents: [],
      events: [statusEvent("s1", 0, null, "OPEN")],
      assignmentEvents: [assignmentEvent("a1", 0, null, ana)],
    } as unknown as RequestWithHistory;

    expect(buildTimeline(tied).map(({ title }) => title)).toEqual(["Solicitação aberta: Aberta", "Assumida por Ana"]);
  });
});
