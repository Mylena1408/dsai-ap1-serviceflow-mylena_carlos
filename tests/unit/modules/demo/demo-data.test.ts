import { describe, expect, it } from "vitest";
import {
  DEMO_NOTIFICATIONS,
  DEMO_REQUESTS,
  DEMO_SERVICE_FIELDS,
  DEMO_SERVICE_SETTINGS,
  demoScenarioProblems,
  demoTimeline,
  type DemoRequestScenario,
} from "@/modules/demo/domain/demo-data";

// SPEC 2026-09-30, section 25.3 (CA-FIC-03): the fictitious requests must be possible through
// the real rules and cover every situation the screens show.

const now = new Date("2026-11-02T15:00:00.000Z");

describe("fictitious demonstration scenarios", () => {
  it.each(DEMO_REQUESTS.map((scenario) => [scenario.key, scenario] as const))(
    "%s is coherent with the request rules",
    (_key, scenario) => {
      expect(demoScenarioProblems(scenario, now)).toEqual([]);
    },
  );

  it("cover every status, the three approval states, a cancellation and an internal note", () => {
    expect(new Set(DEMO_REQUESTS.map(({ outcome }) => outcome))).toEqual(
      new Set(["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"]),
    );
    expect(new Set(DEMO_REQUESTS.flatMap(({ approval }) => (approval ? [approval.decision] : [])))).toEqual(
      new Set(["PENDING", "APPROVED", "REJECTED"]),
    );
    expect(DEMO_REQUESTS.some(({ cancel }) => cancel)).toBe(true);
    expect(DEMO_REQUESTS.flatMap(({ comments }) => comments ?? []).some(({ internal }) => internal)).toBe(true);
    expect(new Set(DEMO_REQUESTS.map(({ requester }) => requester))).toEqual(new Set(["ana", "bruno", "carla"]));
  });

  it("have unique keys, and notifications point to them after the opening", () => {
    const keys = DEMO_REQUESTS.map(({ key }) => key);
    expect(new Set(keys).size).toBe(keys.length);

    for (const notification of DEMO_NOTIFICATIONS) {
      const scenario = DEMO_REQUESTS.find(({ key }) => key === notification.request);
      expect(scenario, notification.request).toBeDefined();
      expect(notification.afterHours).toBeLessThan(scenario!.openedHoursAgo);
    }
  });

  it("answer only fields that exist, including every required one", () => {
    for (const scenario of DEMO_REQUESTS.filter(({ fieldAnswers }) => fieldAnswers)) {
      const fields = DEMO_SERVICE_FIELDS.find(({ service }) => service === scenario.service)?.fields ?? [];
      const labels = fields.map(({ label }) => label);
      expect(labels).toEqual(expect.arrayContaining(Object.keys(scenario.fieldAnswers!)));
      for (const field of fields.filter(({ isRequired }) => isRequired)) {
        expect(scenario.fieldAnswers).toHaveProperty([field.label]);
      }
    }
  });

  it("puts approval only on the service that requires it", () => {
    const approvalServices = Object.entries(DEMO_SERVICE_SETTINGS)
      .filter(([, settings]) => settings?.requiresApproval)
      .map(([name]) => name);

    expect(approvalServices).toEqual(["Solicitação de equipamento"]);
  });

  it("orders the timeline: decision, assumption, start and completion", () => {
    const approved = DEMO_REQUESTS.find(({ approval }) => approval?.decision === "APPROVED")!;
    const timeline = demoTimeline(approved, now);

    expect(timeline.openedAt < timeline.decidedAt!).toBe(true);
    expect(timeline.decidedAt! < timeline.assignedAt!).toBe(true);
    expect(timeline.assignedAt! < timeline.startedAt!).toBe(true);
    expect(timeline.updatedAt).toEqual(timeline.startedAt);
  });

  it("reports incoherent scenarios", () => {
    const base: DemoRequestScenario = {
      key: "x",
      requester: "ana",
      service: "Solicitação de equipamento",
      description: "x",
      outcome: "OPEN",
      openedHoursAgo: 10,
      approval: { decision: "PENDING" },
    };

    expect(demoScenarioProblems(base, now)).toEqual([]);
    expect(demoScenarioProblems({ ...base, outcome: "IN_PROGRESS", startAfterHours: 1 }, now)).toEqual(
      expect.arrayContaining(["pending approval must stay open", "started without approval"]),
    );
    expect(demoScenarioProblems({ ...base, approval: undefined }, now)).toContain("approval does not match the service");
    expect(
      demoScenarioProblems({ ...base, service: "Reparo elétrico", approval: undefined, openedHoursAgo: 1, startAfterHours: 2, outcome: "IN_PROGRESS" }, now),
    ).toContain("something happens after now");
  });
});
