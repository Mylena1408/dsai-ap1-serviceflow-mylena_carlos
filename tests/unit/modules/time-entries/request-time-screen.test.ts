import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RequestTime, dayLabel, timeEventTitle, timeFeedback } from "@/app/_components/request-time";
import { buildTimeline } from "@/app/_components/request-timeline";
import type { RequestWithHistory } from "@/modules/requests";
import type { RequestTimeView } from "@/modules/time-entries";

// SPEC 2026-11-08-atendimento-dia-a-dia, 5.1 item 2, 5.3 item 3 and 13.2 item 1 (SF-208).

const created = new Date("2026-11-12T15:00:00Z");
const view = (overrides: Partial<RequestTimeView> = {}): RequestTimeView => ({
  entries: [
    { id: "e1", requestId: "r1", userId: "ana", userName: "Ana", workedOn: "2026-11-12", minutes: 90, note: "Visita", createdAt: created, deletedAt: null, canChange: true },
    { id: "e2", requestId: "r1", userId: "bia", userName: "Bia", workedOn: "2026-11-11", minutes: 30, note: null, createdAt: created, deletedAt: null, canChange: false },
  ],
  totalMinutes: 120,
  byPerson: [
    { userId: "ana", name: "Ana", minutes: 90 },
    { userId: "bia", name: "Bia", minutes: 30 },
  ],
  estimatedHours: 4,
  events: [],
  canLog: true,
  openedOn: "2026-11-10",
  today: "2026-11-12",
  ...overrides,
});

describe("a request's time block", () => {
  it("shows the total against the estimate, by person, and each entry", () => {
    const html = renderToStaticMarkup(createElement(RequestTime, { requestId: "r1", view: view() }));
    expect(html).toContain("Total: 2h de 4h estimadas");
    expect(html).toContain("Ana: 1h 30min");
    expect(html).toContain("Bia: 30min");
    expect(html).toContain("12/11/2026");
    expect(html).toContain("Visita");
  });

  it("without an estimate shows only the total; with nothing logged nor to log, nothing (CA-HRS-01)", () => {
    expect(renderToStaticMarkup(createElement(RequestTime, { requestId: "r1", view: view({ estimatedHours: null }) }))).toContain("Total: 2h<");
    expect(renderToStaticMarkup(createElement(RequestTime, { requestId: "r1", view: view({ entries: [], byPerson: [], totalMinutes: 0, canLog: false }) }))).toBe("");
    expect(renderToStaticMarkup(createElement(RequestTime, { requestId: "r1", view: view({ entries: [], byPerson: [], totalMinutes: 0 }) }))).toContain(
      "Nenhuma hora lançada.",
    );
  });
});

describe("the time in the history (5.3 item 3)", () => {
  it("names each change with the duration and the day, in time order", () => {
    const request = { createdAt: new Date("2026-11-10T12:00:00Z"), events: [], assignmentEvents: [], priorityEvents: [], stageEvents: [] } as unknown as RequestWithHistory;
    const entries = buildTimeline(request, [], [], [], [
      { id: "t2", occurredAt: new Date("2026-11-12T16:00:00Z"), action: "DELETED", workedOn: "2026-11-12", minutes: 90, actorName: "Ana" },
      { id: "t1", occurredAt: new Date("2026-11-12T15:00:00Z"), action: "CREATED", workedOn: "2026-11-12", minutes: 90, actorName: "Ana" },
    ]);
    expect(entries.map(({ title, actor }) => [title, actor])).toEqual([
      ["Horas lançadas: 1h 30min em 12/11/2026", "Ana"],
      ["Horas apagadas: 1h 30min em 12/11/2026", "Ana"],
    ]);
    expect(timeEventTitle({ action: "UPDATED", minutes: 45, workedOn: "2026-11-11" })).toBe("Horas alteradas: 45min em 11/11/2026");
    expect(dayLabel("2026-01-05")).toBe("05/01/2026");
  });
});

// SPEC 2026-11-08-atendimento-dia-a-dia, 5.3 (SF-210): the attendant's forms.
describe("the time forms", () => {
  const action = async (): Promise<never> => {
    throw new Error("not called");
  };
  const edit = { logAction: action, updateAction: action, deleteAction: action };

  it("logs between the opening and today, and changes or removes only the person's own entries", () => {
    const html = renderToStaticMarkup(createElement(RequestTime, { requestId: "r1", view: view(), edit }));
    expect(html).toContain('aria-label="Lançar horas"');
    expect(html).toContain('min="2026-11-10"');
    expect(html).toContain('max="2026-11-12"');
    expect(html).toContain("Alterar o lançamento de 12/11/2026");
    expect(html).toContain("Apagar o lançamento de 12/11/2026");
    expect(html).not.toContain("Apagar o lançamento de 11/11/2026");
  });

  it("without the right to log, or for the manager, only shows", () => {
    expect(renderToStaticMarkup(createElement(RequestTime, { requestId: "r1", view: view({ canLog: false }), edit }))).not.toContain("Lançar horas");
    expect(renderToStaticMarkup(createElement(RequestTime, { requestId: "r1", view: view() }))).not.toContain("<form");
  });

  it("explains each result", () => {
    expect(timeFeedback("time-logged")).toBe("Horas lançadas.");
    expect(timeFeedback("time-day")).toContain("entre a abertura");
    expect(timeFeedback("other")).toBeNull();
  });
});
