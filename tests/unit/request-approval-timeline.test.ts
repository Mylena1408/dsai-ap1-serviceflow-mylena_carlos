import { describe, expect, it } from "vitest";
import { buildTimeline } from "@/app/_components/request-timeline";
import type { RequestWithHistory } from "@/modules/requests";

// SPEC 2026-11-01-aprovacoes, section 5.6 (SF-085): the decision in the timeline.

const at = (minute: number) => new Date(`2026-11-01T12:${String(minute).padStart(2, "0")}:00.000Z`);
const rita = { id: "rita", name: "Rita", email: "r@example.test" };
const gabi = { id: "gabi", name: "Gabi" };

function request(approval: RequestWithHistory["approval"], events: unknown[]) {
  return { events, assignmentEvents: [], priorityEvents: [], stageEvents: [], approval } as unknown as RequestWithHistory;
}

const opened = { id: "s1", requestId: "r", actorId: rita.id, fromStatus: null, toStatus: "OPEN", occurredAt: at(0), note: null, actor: rita };

describe("approval in the timeline (SF-085)", () => {
  it("shows an approval with its note", () => {
    const timeline = buildTimeline(
      request(
        { id: "a1", requestId: "r", deciderId: gabi.id, decision: "APPROVED", note: "Dentro do orçamento", decidedAt: at(2), decider: gabi },
        [opened],
      ),
    );

    expect(timeline.map(({ title, note, noteLabel }) => [title, note, noteLabel])).toEqual([
      ["Solicitação aberta: Aberta", null, undefined],
      ["Aprovada por Gabi", "Dentro do orçamento", "Observação"],
    ]);
  });

  it("shows the note of a rejection once, on the decision, not on the cancellation it caused", () => {
    const cancelled = {
      id: "s2",
      requestId: "r",
      actorId: gabi.id,
      fromStatus: "OPEN",
      toStatus: "CANCELLED",
      occurredAt: at(3),
      note: "Fora do orçamento",
      actor: { ...gabi, email: "g@example.test" },
    };
    const timeline = buildTimeline(
      request(
        { id: "a1", requestId: "r", deciderId: gabi.id, decision: "REJECTED", note: "Fora do orçamento", decidedAt: at(3), decider: gabi },
        [opened, cancelled],
      ),
    );

    expect(timeline.map(({ title, note }) => [title, note])).toEqual([
      ["Solicitação aberta: Aberta", null],
      ["Aberta → Cancelada", null],
      ["Rejeitada por Gabi", "Fora do orçamento"],
    ]);
  });

  it("keeps the reason of a cancellation that is not a rejection", () => {
    const cancelled = { ...opened, id: "s2", fromStatus: "OPEN", toStatus: "CANCELLED", occurredAt: at(4), note: "Desisti" };

    expect(buildTimeline(request(null, [opened, cancelled])).map(({ note }) => note)).toEqual([null, "Desisti"]);
  });
});
