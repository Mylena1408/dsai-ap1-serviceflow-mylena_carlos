import { describe, expect, it } from "vitest";
import {
  NO_STAGE_DETAILS,
  stageAssigneeAt,
  stageCopyFromSettings,
  stageDueAtFrom,
  stageTargetDaysAt,
  type StageSettings,
} from "@/modules/requests/domain/stages";
import { assertStageAssignee } from "@/modules/service-stages/domain/service-stage";
import { serviceStageSettingsSchema } from "@/modules/service-stages/application/service-stage-schemas";
import { ValidationError } from "@/server/errors";

// SPEC 2026-11-06-aprofundamento-configurabilidade, 5.3 and 5.4 (SF-168).

const stage = (name: string, extra: Partial<StageSettings> = {}): StageSettings => ({
  name,
  assigneeId: null,
  targetDays: null,
  conditionFieldId: null,
  conditionValue: null,
  ...extra,
});

describe("stage copy with settings (SF-168)", () => {
  const stages = [
    stage("Triagem"),
    stage("Bancada", { assigneeId: "bia", targetDays: 3, conditionFieldId: "kind", conditionValue: "Hardware" }),
    stage("Licença", { conditionFieldId: "items", conditionValue: "Office" }),
    stage("Testes", { targetDays: 1 }),
  ];

  it("keeps the stages whose condition the answers meet, with attendant and target per stage", () => {
    expect(
      stageCopyFromSettings(stages, [
        { fieldId: "kind", type: "SELECT", value: "Hardware" },
        { fieldId: "items", type: "MULTI_SELECT", value: '["Mouse","Office"]' },
      ]),
    ).toEqual({
      stageNamesSnapshot: ["Triagem", "Bancada", "Licença", "Testes"],
      stageIndex: 0,
      stageAssigneeIdsSnapshot: ["", "bia", "", ""],
      stageTargetDaysSnapshot: [0, 3, 0, 1],
    });
    expect(stageCopyFromSettings(stages, [{ fieldId: "kind", type: "SELECT", value: "Software" }])).toMatchObject({
      stageNamesSnapshot: ["Triagem", "Testes"],
      stageAssigneeIdsSnapshot: ["", ""],
      stageTargetDaysSnapshot: [0, 1],
    });
  });

  it("has no flow when no stage is left, or no stage at all", () => {
    const empty = { stageNamesSnapshot: [], stageIndex: null, stageAssigneeIdsSnapshot: [], stageTargetDaysSnapshot: [] };
    expect(stageCopyFromSettings([stage("Bancada", { conditionFieldId: "kind", conditionValue: "Hardware" })], [])).toEqual(empty);
    expect(stageCopyFromSettings([], [])).toEqual(empty);
  });

  it("reads the attendant and the target of a stage, and nothing for copies taken before details existed", () => {
    const details = { stageAssigneeIdsSnapshot: ["", "bia"], stageTargetDaysSnapshot: [0, 3] };
    expect(stageAssigneeAt(details, 1)).toBe("bia");
    expect(stageAssigneeAt(details, 0)).toBeNull();
    expect(stageTargetDaysAt(details, 1)).toBe(3);
    expect(stageTargetDaysAt(details, 0)).toBeNull();
    expect(stageAssigneeAt({}, 0)).toBeNull();
    expect(stageTargetDaysAt({ stageTargetDaysSnapshot: [] }, 2)).toBeNull();
  });

  it("counts the stage target in calendar days, and clears the details on reopening", () => {
    const entered = new Date("2026-11-07T12:00:00.000Z");
    expect(stageDueAtFrom(entered, 2)).toEqual(new Date("2026-11-09T12:00:00.000Z"));
    expect(stageDueAtFrom(entered, null)).toBeNull();
    expect(NO_STAGE_DETAILS).toEqual({ stageAssigneeIdsSnapshot: [], stageTargetDaysSnapshot: [], stageDueAt: null, stageOverdueNotifiedAt: null });
  });
});

describe("stage settings configuration (SF-168)", () => {
  it("accepts only an active attendant of the service's sector", () => {
    const attendant = { role: "ATTENDANT", isActive: true, sectorId: "s1" };
    expect(() => assertStageAssignee(attendant, "s1")).not.toThrow();
    expect(() => assertStageAssignee({ ...attendant, sectorId: "s2" }, "s1")).toThrow(ValidationError);
    expect(() => assertStageAssignee({ ...attendant, isActive: false }, "s1")).toThrow(ValidationError);
    expect(() => assertStageAssignee({ ...attendant, role: "MANAGER" }, "s1")).toThrow(ValidationError);
    expect(() => assertStageAssignee(null, "s1")).toThrow(ValidationError);
  });

  it("validates the settings: target 1 to 30, condition complete, blank value as none", () => {
    const parse = (input: Record<string, unknown>) =>
      serviceStageSettingsSchema.safeParse({ assigneeId: null, targetDays: null, conditionFieldId: null, conditionValue: null, ...input });
    expect(parse({ targetDays: 30 }).success).toBe(true);
    expect(parse({ targetDays: 0 }).success).toBe(false);
    expect(parse({ targetDays: 1.5 }).success).toBe(false);
    expect(parse({ conditionFieldId: "00000000-0000-4000-8000-000000000001" }).success).toBe(false);
    expect(parse({ conditionValue: "  " })).toMatchObject({ success: true, data: { conditionValue: null } });
    expect(parse({ assigneeId: "x" }).success).toBe(false);
    expect(parse({ extra: 1 }).success).toBe(false);
  });
});
