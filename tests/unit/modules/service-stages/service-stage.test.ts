import { describe, expect, it } from "vitest";
import { ConflictError } from "@/server/errors";
import { serviceStageInputSchema } from "@/modules/service-stages/application/service-stage-schemas";
import {
  MAX_ACTIVE_SERVICE_STAGES,
  assertCanAddActiveStage,
  assertStageNameAvailable,
} from "@/modules/service-stages/domain/service-stage";

// SPEC 2026-11-01-fluxos-configuraveis, section 5.1 (SF-076; rules of CA-FLX-03).

describe("stage configuration rules (SF-076)", () => {
  it("accepts a trimmed name of 1 to 60 characters", () => {
    expect(serviceStageInputSchema.parse({ name: "  Triagem  " })).toEqual({ name: "Triagem" });
    expect(serviceStageInputSchema.safeParse({ name: "a".repeat(60) }).success).toBe(true);
    expect(serviceStageInputSchema.safeParse({ name: "a".repeat(61) }).success).toBe(false);
    expect(serviceStageInputSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("refuses service, position or state coming from input", () => {
    expect(serviceStageInputSchema.safeParse({ name: "Triagem", serviceId: "x", position: 0 }).success).toBe(false);
  });

  it("allows up to eight active stages", () => {
    expect(MAX_ACTIVE_SERVICE_STAGES).toBe(8);
    expect(() => assertCanAddActiveStage(7)).not.toThrow();
    expect(() => assertCanAddActiveStage(8)).toThrow(ConflictError);
  });

  it("refuses a name already used by an active stage, ignoring case", () => {
    const active = [{ name: "Triagem" }, { name: "Execução" }];

    expect(() => assertStageNameAvailable(active, "TRIAGEM")).toThrow(ConflictError);
    expect(() => assertStageNameAvailable(active, "execução")).toThrow(ConflictError);
    expect(() => assertStageNameAvailable(active, "Testes")).not.toThrow();
  });
});
