import { describe, expect, it, vi } from "vitest";
import { distributeOnEntry } from "@/modules/requests/application/distribute";
import type { RequestTransaction } from "@/modules/requests/application/ports";
import type { DistributionCandidate, DistributionSettings } from "@/modules/requests/domain/distribution";
import { buildTimeline, systemActorName } from "@/app/_components/request-timeline";
import type { RequestWithHistory } from "@/modules/requests";

// SPEC 2026-11-07-operacao-e-automacao, 4.3 items 2, 5 and 6 (SF-181).

const now = new Date("2026-11-07T12:00:00Z");
const person = (id: string, name: string): DistributionCandidate => ({
  id,
  name,
  role: "ATTENDANT",
  isActive: true,
  sectorId: "ti",
  activeRequests: 0,
  absentToday: false,
});

function transaction(settings: DistributionSettings | null, changed = 1) {
  const double = {
    lockSectorDistribution: vi.fn(async () => settings),
    distributionCandidates: vi.fn(async () => [person("b", "Bia"), person("a", "Ana")]),
    updateAssigneeIfCurrent: vi.fn(async () => changed),
    insertAssignmentEvent: vi.fn(async () => undefined),
    recordEvent: vi.fn(async () => undefined),
    setLastDistributed: vi.fn(async () => undefined),
  };
  return { double, transaction: double as unknown as RequestTransaction };
}

const entry = { requestId: "q", sectorId: "ti", status: "OPEN" as const, occurredAt: now };

describe("distribution at the entrance of the queue", () => {
  it("does nothing when the sector does not distribute", async () => {
    const off = transaction({ mode: "NONE", maxActivePerAttendant: null, lastDistributedToId: null });
    await expect(distributeOnEntry(off.transaction, entry)).resolves.toBeNull();
    expect(off.double.distributionCandidates).not.toHaveBeenCalled();
    expect(off.double.updateAssigneeIfCurrent).not.toHaveBeenCalled();
    await expect(distributeOnEntry(transaction(null).transaction, entry)).resolves.toBeNull();
  });

  it("locks the sector, assigns as the system with the reason, warns and moves the turn", async () => {
    const { double, transaction: tx } = transaction({ mode: "ROUND_ROBIN", maxActivePerAttendant: null, lastDistributedToId: null });
    await expect(distributeOnEntry(tx, entry)).resolves.toBe("a");
    expect(double.lockSectorDistribution).toHaveBeenCalledWith("ti");
    expect(double.updateAssigneeIfCurrent).toHaveBeenCalledWith({ requestId: "q", expectedStatus: "OPEN", expectedAssigneeId: null, assigneeId: "a", updatedAt: now });
    expect(double.insertAssignmentEvent).toHaveBeenCalledWith({ requestId: "q", actorId: null, reason: "DISTRIBUTION", fromAssigneeId: null, toAssigneeId: "a", occurredAt: now });
    expect(double.recordEvent).toHaveBeenCalledWith({
      type: "request.assignment_changed",
      requestId: "q",
      occurredAt: now,
      payload: { fromAssigneeId: null, toAssigneeId: "a", actorId: null },
    });
    expect(double.setLastDistributed).toHaveBeenCalledWith("ti", "a");
  });

  it("skips the excluded people, and records nothing when the request changed meanwhile", async () => {
    const excluded = transaction({ mode: "ROUND_ROBIN", maxActivePerAttendant: null, lastDistributedToId: null });
    await expect(distributeOnEntry(excluded.transaction, { ...entry, exclude: ["a"] })).resolves.toBe("b");

    const changed = transaction({ mode: "ROUND_ROBIN", maxActivePerAttendant: null, lastDistributedToId: null }, 0);
    await expect(distributeOnEntry(changed.transaction, entry)).resolves.toBeNull();
    expect(changed.double.insertAssignmentEvent).not.toHaveBeenCalled();
    expect(changed.double.setLastDistributed).not.toHaveBeenCalled();
  });
});

describe("system changes in the history (decision H19)", () => {
  it("names the reason of each system change", () => {
    expect(systemActorName("DISTRIBUTION")).toBe("Sistema (distribuição automática)");
    expect(systemActorName("ABSENCE")).toBe("Sistema (ausência do responsável)");
    expect(systemActorName("ESCALATION_RULE")).toBe("Sistema (regra de escalonamento)");
    expect(systemActorName(null)).toBe("Sistema (regra de escalonamento)");

    const event = (id: string, reason: "DISTRIBUTION" | "ABSENCE", from: { id: string; name: string } | null) => ({
      id,
      requestId: "q",
      actorId: null,
      actor: null,
      reason,
      fromAssigneeId: from?.id ?? null,
      toAssigneeId: "b",
      fromAssignee: from,
      toAssignee: { id: "b", name: "Bia" },
      occurredAt: now,
    });
    const request = {
      events: [],
      assignmentEvents: [event("e1", "DISTRIBUTION", null), event("e2", "ABSENCE", { id: "a", name: "Ana" })],
      priorityEvents: [],
      stageEvents: [],
      sectorEvents: [],
      fieldUpdates: [],
      slaPauses: [],
      approvals: [],
      approval: null,
    } as unknown as RequestWithHistory;
    expect(buildTimeline(request).map(({ title, actor }) => [title, actor])).toEqual([
      ["Distribuída automaticamente a Bia", "Sistema (distribuição automática)"],
      ["Passada de Ana para Bia pela ausência do responsável", "Sistema (ausência do responsável)"],
    ]);
  });
});
