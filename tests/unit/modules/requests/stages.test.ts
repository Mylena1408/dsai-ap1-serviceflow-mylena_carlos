import { describe, expect, it } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { assertCanMoveStage, type LifecycleRequest, type LifecycleUser } from "@/modules/requests/domain/lifecycle";
import {
  NO_STAGE,
  assertCanCompleteAtStage,
  hasStages,
  planStageMove,
  stageCopyOnStart,
  type StageState,
} from "@/modules/requests/domain/stages";

// SPEC 2026-11-01-fluxos-configuraveis, sections 5.2 to 5.4 (SF-076; rules of CA-FLX-05 and 06).

const flow = ["Triagem", "Execução", "Testes"];

function state(overrides: Partial<StageState> = {}): StageState {
  return { status: "IN_PROGRESS", stageNamesSnapshot: flow, stageIndex: 0, ...overrides };
}

describe("stage copy (SF-076)", () => {
  it("copies the active stages in order and enters the first one", () => {
    const names = ["Triagem", "Execução"];
    const copy = stageCopyOnStart(names);

    expect(copy).toEqual({ stageNamesSnapshot: ["Triagem", "Execução"], stageIndex: 0 });
    names.push("Mudou depois");
    expect(copy.stageNamesSnapshot).toEqual(["Triagem", "Execução"]);
  });

  it("copies nothing for a service without stages, as before", () => {
    expect(stageCopyOnStart([])).toEqual({ stageNamesSnapshot: [], stageIndex: null });
    expect(NO_STAGE).toEqual({ stageNamesSnapshot: [], stageIndex: null });
    expect(hasStages(state({ stageNamesSnapshot: [], stageIndex: null }))).toBe(false);
    expect(hasStages(state())).toBe(true);
  });
});

describe("planStageMove (SF-076)", () => {
  it("advances one stage at a time without a reason", () => {
    expect(planStageMove(state(), "advance", "ignorada")).toEqual({
      fromIndex: 0,
      toIndex: 1,
      fromStage: "Triagem",
      toStage: "Execução",
      note: null,
    });
    expect(planStageMove(state({ stageIndex: 1 }), "advance")).toMatchObject({ toIndex: 2, toStage: "Testes" });
  });

  it("goes back one stage with a trimmed reason", () => {
    expect(planStageMove(state({ stageIndex: 2 }), "return", "  Falhou no teste  ")).toEqual({
      fromIndex: 2,
      toIndex: 1,
      fromStage: "Testes",
      toStage: "Execução",
      note: "Falhou no teste",
    });
  });

  it("requires a reason of 1 to 1,000 characters to go back", () => {
    for (const note of [undefined, null, "", "   "]) {
      expect(() => planStageMove(state({ stageIndex: 1 }), "return", note)).toThrow(ValidationError);
    }
    expect(() => planStageMove(state({ stageIndex: 1 }), "return", "a".repeat(1001))).toThrow(ValidationError);
    expect(planStageMove(state({ stageIndex: 1 }), "return", "a".repeat(1000)).note).toHaveLength(1000);
  });

  it("never moves past the last stage or before the first", () => {
    expect(() => planStageMove(state({ stageIndex: 2 }), "advance")).toThrow(ConflictError);
    expect(() => planStageMove(state({ stageIndex: 0 }), "return", "motivo")).toThrow(ConflictError);
  });

  it("moves only in-progress requests that have a flow", () => {
    for (const status of ["OPEN", "COMPLETED", "CANCELLED"] as const) {
      expect(() => planStageMove(state({ status }), "advance")).toThrow(ConflictError);
    }
    expect(() => planStageMove(state({ stageNamesSnapshot: [], stageIndex: null }), "advance")).toThrow(ConflictError);
  });
});

describe("completion at the last stage (SF-076)", () => {
  it("completes a request with a flow only at its last stage", () => {
    expect(() => assertCanCompleteAtStage(state({ stageIndex: 0 }))).toThrow(ConflictError);
    expect(() => assertCanCompleteAtStage(state({ stageIndex: 1 }))).toThrow(ConflictError);
    expect(() => assertCanCompleteAtStage(state({ stageIndex: 2 }))).not.toThrow();
  });

  it("does not restrict requests without a flow", () => {
    expect(() => assertCanCompleteAtStage(state({ stageNamesSnapshot: [], stageIndex: null }))).not.toThrow();
  });
});

describe("assertCanMoveStage (SF-076)", () => {
  const sectorId = "sector-1";
  const attendant: LifecycleUser = { id: "a1", role: "ATTENDANT", isActive: true, sectorId };
  const colleague: LifecycleUser = { id: "a2", role: "ATTENDANT", isActive: true, sectorId };
  const request = (assignee: LifecycleUser | null = null): LifecycleRequest => ({
    requesterId: "r1",
    sectorId,
    status: "IN_PROGRESS",
    completedAt: null,
    assignee,
  });

  it("lets any attendant of the sector move a request without an assignee", () => {
    expect(() => assertCanMoveStage(attendant, request())).not.toThrow();
    expect(() => assertCanMoveStage(colleague, request())).not.toThrow();
  });

  it("lets only the effective assignee move a held request", () => {
    expect(() => assertCanMoveStage(attendant, request(attendant))).not.toThrow();
    expect(() => assertCanMoveStage(colleague, request(attendant))).toThrow(ConflictError);
    expect(() => assertCanMoveStage(colleague, request({ ...attendant, isActive: false }))).not.toThrow();
  });

  it("hides the request from people outside the sector", () => {
    for (const actor of [
      { ...attendant, sectorId: "other" },
      { ...attendant, isActive: false },
      { id: "r1", role: "REQUESTER" as const, isActive: true, sectorId: null },
      { id: "ad", role: "ADMIN" as const, isActive: true, sectorId: null },
    ]) {
      expect(() => assertCanMoveStage(actor, request())).toThrow(NotFoundError);
    }
  });
});
