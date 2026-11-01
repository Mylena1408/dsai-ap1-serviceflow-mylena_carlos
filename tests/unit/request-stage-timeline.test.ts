import { describe, expect, it, vi } from "vitest";

// The notification component reads the unread count through the module; only its messages are tested here.
vi.mock("@/modules/notifications", () => ({ countUnreadNotifications: vi.fn() }));
import { buildTimeline } from "@/app/_components/request-timeline";
import { stageSummary } from "@/app/_components/request-stage";
import { notificationMessage } from "@/app/_components/notifications";
import { plannedNotifications } from "@/modules/notifications/domain/recipients";
import type { RequestWithHistory } from "@/modules/requests";

// SPEC 2026-11-01-fluxos-configuraveis, sections 5.5 and 5.6 (SF-079; CA-FLX-08 and 10).

const at = (minute: number) => new Date(`2026-11-01T12:${String(minute).padStart(2, "0")}:00.000Z`);
const ana = { id: "ana", name: "Ana" };

describe("stage summary (SF-079)", () => {
  it("shows the position and the name of the current stage", () => {
    const names = ["Triagem", "Execução", "Testes", "Entrega"];
    expect(stageSummary({ stageNamesSnapshot: names, stageIndex: 0 })).toBe("Etapa 1 de 4: Triagem");
    expect(stageSummary({ stageNamesSnapshot: names, stageIndex: 1 })).toBe("Etapa 2 de 4: Execução");
    expect(stageSummary({ stageNamesSnapshot: names, stageIndex: 3 })).toBe("Etapa 4 de 4: Entrega");
  });

  it("shows nothing for a request without a flow", () => {
    expect(stageSummary({ stageNamesSnapshot: [], stageIndex: null })).toBeNull();
  });
});

describe("stage moves in the timeline (SF-079)", () => {
  it("lists the first stage, moves and the reason of a return in chronological order (CA-FLX-08)", () => {
    const stageEvent = (id: string, minute: number, fromStage: string | null, toStage: string, note: string | null = null) => ({
      id,
      requestId: "r",
      actorId: ana.id,
      fromStage,
      toStage,
      note,
      occurredAt: at(minute),
      actor: ana,
    });
    const request = {
      events: [
        { id: "s1", requestId: "r", actorId: "rita", fromStatus: null, toStatus: "OPEN", occurredAt: at(0), note: null, actor: { id: "rita", name: "Rita", email: "r@example.test" } },
        { id: "s2", requestId: "r", actorId: ana.id, fromStatus: "OPEN", toStatus: "IN_PROGRESS", occurredAt: at(1), note: null, actor: { ...ana, email: "a@example.test" } },
      ],
      assignmentEvents: [],
      priorityEvents: [],
      stageEvents: [
        stageEvent("e3", 3, "Execução", "Triagem", "Faltou a peça"),
        stageEvent("e1", 1, null, "Triagem"),
        stageEvent("e2", 2, "Triagem", "Execução"),
      ],
    } as unknown as RequestWithHistory;

    expect(buildTimeline(request).map(({ title, actor, note }) => [title, actor, note])).toEqual([
      ["Solicitação aberta: Aberta", "Rita", null],
      ["Aberta → Em atendimento", "Ana", null],
      ["Etapa: Triagem", "Ana", null],
      ["Etapa: Triagem → Execução", "Ana", null],
      ["Etapa: Execução → Triagem", "Ana", "Faltou a peça"],
    ]);
  });
});

describe("stage notifications (SF-079)", () => {
  const context = { requesterId: "rita", effectiveAssigneeId: "ana" };

  it("notifies the requester of every move made by the team (decision W4)", () => {
    for (const direction of ["advance", "return"]) {
      expect(
        plannedNotifications({ type: "request.stage_changed", payload: { direction, actorId: "ana" } }, context),
      ).toEqual([{ recipientId: "rita", type: "stage.changed" }]);
    }
  });

  it("does not notify the entry into the first stage, which comes with the start", () => {
    expect(
      plannedNotifications({ type: "request.stage_changed", payload: { direction: "start", actorId: "ana" } }, context),
    ).toEqual([]);
  });

  it("names the stage when it is known and falls back to a generic text", () => {
    const base = { id: "n", requestId: "r", type: "stage.changed" as const, createdAt: at(0), readAt: null, serviceName: "Reparo" };

    expect(notificationMessage({ ...base, stageName: "Execução" })).toBe("Sua solicitação passou para a etapa Execução: Reparo");
    expect(notificationMessage(base)).toBe("Sua solicitação mudou de etapa: Reparo");
  });
});
