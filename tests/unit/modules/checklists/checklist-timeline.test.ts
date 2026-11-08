import { describe, expect, it } from "vitest";
import { buildTimeline, checklistEventTitle } from "@/app/_components/request-timeline";
import type { RequestWithHistory } from "@/modules/requests";

// SPEC 2026-11-08-atendimento-dia-a-dia, 4.3 item 3 and 13.1 item 4 (SF-203): the checklist in the history.

describe("history lines of the checklist", () => {
  it("names the item, who marked or unmarked it, and the note, in time order with the other events", () => {
    const request = {
      createdAt: new Date("2026-11-08T12:00:00Z"),
      events: [],
      assignmentEvents: [],
      priorityEvents: [],
      stageEvents: [],
    } as unknown as RequestWithHistory;

    const entries = buildTimeline(request, [], [], [
      { id: "e2", occurredAt: new Date("2026-11-08T14:00:00Z"), action: "UNDONE", itemText: "Instalar", note: null, actorName: "Bia" },
      { id: "e1", occurredAt: new Date("2026-11-08T13:00:00Z"), action: "DONE", itemText: "Instalar", note: "Versão 2.1", actorName: "Ana" },
    ]);

    expect(entries.map(({ id, title, actor, note, noteLabel }) => [id, title, actor, note, noteLabel])).toEqual([
      ["checklist-e1", 'Item do checklist "Instalar" concluído', "Ana", "Versão 2.1", "Observação"],
      ["checklist-e2", 'Item do checklist "Instalar" desmarcado', "Bia", null, "Observação"],
    ]);
    expect(checklistEventTitle({ action: "DONE", itemText: "Testar" })).toBe('Item do checklist "Testar" concluído');
  });
});
