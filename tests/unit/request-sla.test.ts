import { describe, expect, it, vi } from "vitest";

// The module entry point loads the session; the component only needs the domain rule.
vi.mock("@/modules/requests", async () => {
  const { slaSituation } = await import("@/modules/requests/domain/sla");
  return { slaSituation };
});

import { slaSummary } from "@/app/_components/request-sla";
import { hasSearchCriteria, searchPageHref } from "@/app/_components/request-search-url";
import { parseSearchCriteria } from "@/modules/requests/domain/search-criteria";
import { ValidationError } from "@/server/errors";

// SPEC 2026-11-01-sla-prioridades, sections 5.4 and 5.6 (SF-068).

const now = new Date("2026-11-01T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const base = { status: "OPEN" as const, priority: "HIGH" as const, slaHoursSnapshot: 10, completedLate: null };

describe("SLA summary on screens", () => {
  it("shows priority, situation and the due date only while the deadline runs", () => {
    expect(slaSummary({ ...base, dueAt: new Date(now.getTime() + 4 * HOUR) }, now)).toEqual({
      priority: "Alta",
      situation: "on_time",
      situationLabel: "Dentro do prazo",
      dueAt: new Date(now.getTime() + 4 * HOUR),
    });
    expect(slaSummary({ ...base, dueAt: new Date(now.getTime() + HOUR) }, now).situationLabel).toBe(
      "Próximo do vencimento",
    );
    expect(slaSummary({ ...base, dueAt: new Date(now.getTime() - 1) }, now).situationLabel).toBe("Vencido");
    expect(slaSummary({ ...base, slaHoursSnapshot: null, dueAt: null }, now)).toMatchObject({
      situationLabel: "Sem prazo",
      dueAt: null,
    });
    expect(
      slaSummary({ ...base, status: "COMPLETED", completedLate: true, dueAt: new Date(now.getTime() - HOUR) }, now),
    ).toMatchObject({ situationLabel: "Concluída com atraso", dueAt: null });
  });
});

describe("SLA criteria of the queue (CA-SLA-09)", () => {
  it("accepts the SLA filter and the due order only in the queue", () => {
    expect(parseSearchCriteria({ sla: "due_soon", order: "due" }, "attendant")).toMatchObject({
      sla: "due_soon",
      order: "due",
    });
    expect(parseSearchCriteria({ sla: "" }, "attendant")).not.toHaveProperty("sla");
    expect(parseSearchCriteria({ sla: "overdue" }, "requester")).not.toHaveProperty("sla");
    expect(() => parseSearchCriteria({ sla: "late" }, "attendant")).toThrow(ValidationError);
    expect(() => parseSearchCriteria({ order: "due" }, "requester")).toThrow(ValidationError);
  });

  it("keeps the SLA filter across pages and counts it as a criterion", () => {
    expect(searchPageHref("/queue", { sla: "overdue", order: "due" }, 2)).toBe("/queue?sla=overdue&order=due&page=2");
    expect(hasSearchCriteria({ sla: "none" })).toBe(true);
    expect(hasSearchCriteria({ sla: "", order: "due" })).toBe(false);
  });
});
