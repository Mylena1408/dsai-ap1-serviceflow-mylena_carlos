import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { escalatedPriority } from "@/modules/requests/domain/escalation";
import { plannedNotifications } from "@/modules/notifications/domain/recipients";
import { RequestEscalations } from "@/app/_components/request-escalations";

// SPEC 2026-11-06-escalonamento, 4.3, 4.5 and 4.7 (SF-154 and SF-155; CA-ESC-02, 04, 06).

describe("escalatedPriority (4.3)", () => {
  it("raises one level and stops at urgent", () => {
    expect(["LOW", "NORMAL", "HIGH", "URGENT"].map((priority) => escalatedPriority(priority as never))).toEqual([
      "NORMAL",
      "HIGH",
      "URGENT",
      "URGENT",
    ]);
  });
});

describe("notifications of an escalated breach (4.5)", () => {
  const breach = { type: "request.sla_breached" as const, payload: {} };
  const base = { requesterId: "rita", effectiveAssigneeId: "ana", slaRecipients: { requestActive: true, sectorAttendantIds: [] } };

  it("keeps the breach recipients and adds the managers when escalated", () => {
    expect(plannedNotifications(breach as never, { ...base, escalationManagerIds: ["gabi", "hugo"] } as never)).toEqual([
      { recipientId: "ana", type: "sla.breached" },
      { recipientId: "gabi", type: "sla.escalated" },
      { recipientId: "hugo", type: "sla.escalated" },
    ]);
  });

  it("adds nobody without an escalation, and never the same person twice", () => {
    expect(plannedNotifications(breach as never, base as never)).toEqual([{ recipientId: "ana", type: "sla.breached" }]);
    expect(plannedNotifications(breach as never, { ...base, escalationManagerIds: ["ana"] } as never)).toEqual([{ recipientId: "ana", type: "sla.breached" }]);
  });

  it("never escalates a warning", () => {
    const warning = { type: "request.sla_warning" as const, payload: {} };
    expect(plannedNotifications(warning as never, { ...base, escalationManagerIds: ["gabi"] } as never)).toEqual([{ recipientId: "ana", type: "sla.warning" }]);
  });
});

describe("escalations block (4.7)", () => {
  it("shows each escalation with the priorities, or that urgent stayed urgent", () => {
    const html = renderToStaticMarkup(
      createElement(RequestEscalations, {
        escalations: [
          { fromPriority: "NORMAL", toPriority: "HIGH", occurredAt: new Date("2026-11-05T12:00:00Z") },
          { fromPriority: "URGENT", toPriority: "URGENT", occurredAt: new Date("2026-11-06T12:00:00Z") },
        ],
      }),
    );
    expect(html).toContain("prioridade Normal → Alta");
    expect(html).toContain("prioridade mantida em Urgente");
    expect(html).toContain("Os gestores do setor foram avisados.");
    expect(renderToStaticMarkup(createElement(RequestEscalations, { escalations: [] }))).toBe("");
  });
});
