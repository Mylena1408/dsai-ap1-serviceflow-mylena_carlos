import { describe, expect, it } from "vitest";
import { buildTimeline } from "@/app/_components/request-timeline";
import type { RequestWithHistory } from "@/modules/requests";

// SPEC 2026-11-03-campos-condicionais-atendimento, 5.5.3 (SF-136): labels only, never the values.

describe("history line of the attendance fields", () => {
  it("names the changed fields and who saved them", () => {
    const request = {
      createdAt: new Date("2026-11-03T12:00:00Z"),
      events: [],
      assignmentEvents: [],
      priorityEvents: [],
      stageEvents: [],
      fieldUpdates: [
        { id: "u1", labels: ["Ordem de serviço", "Peça trocada"], occurredAt: new Date("2026-11-03T13:00:00Z"), actor: { id: "ana", name: "Ana" } },
      ],
    } as unknown as RequestWithHistory;

    expect(buildTimeline(request).map(({ title, actor, note }) => [title, actor, note])).toEqual([
      ["Informações do atendimento atualizadas: Ordem de serviço, Peça trocada", "Ana", null],
    ]);
  });
});
