import { describe, expect, it } from "vitest";
import { serviceApprovalFailure, serviceApprovalFields } from "@/app/(admin)/admin/_shared/action-helpers";
import { approvalSummary } from "@/app/(admin)/admin/service-approval-editor";
import { absenceMessage } from "@/app/(admin)/admin/_sections/absences/absences-section";
import {
  approvalDecisionsRepresentation,
  approvalProgressRepresentation,
  serviceApprovalRepresentation,
} from "@/modules/public-api/domain/representation";
import { serviceApprovalInputSchema } from "@/modules/services/application/service-schemas";
import { ValidationError } from "@/server/errors";

// SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3 (SF-167): the approval form of the
// administration, the absences messages and the API representations.

function formData(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const SECTORS = [
  { id: "purchasing", name: "Compras" },
  { id: "finance", name: "Financeiro" },
];

describe("approval form of a service (SF-167)", () => {
  it("reads the levels in order, without the empty ones, and the default level as no level", () => {
    expect(
      serviceApprovalFields(formData({ serviceSectorId: "purchasing", level1: "purchasing", level2: "finance", level3: "", condition: "", deadlineDays: "" })),
    ).toEqual({ sectorIds: ["purchasing", "finance"], conditionFieldId: null, conditionValue: null, deadlineDays: null });
    expect(serviceApprovalFields(formData({ serviceSectorId: "purchasing", level1: "purchasing", condition: "", deadlineDays: "3" }))).toMatchObject({
      sectorIds: [],
      deadlineDays: 3,
    });
    expect(serviceApprovalFields(formData({ serviceSectorId: "purchasing", level1: "finance" }))).toMatchObject({ sectorIds: ["finance"] });
  });

  it("splits the condition at the first separator and passes unexpected days to validation", () => {
    expect(serviceApprovalFields(formData({ serviceSectorId: "s", level1: "s", condition: "field-1::Acima::de mil", deadlineDays: "dois" }))).toMatchObject({
      conditionFieldId: "field-1",
      conditionValue: "Acima::de mil",
      deadlineDays: "dois",
    });
  });

  it("goes through the schema: the form's days are a number from 1 to 30", () => {
    const parse = (days: string) =>
      serviceApprovalInputSchema.safeParse(serviceApprovalFields(formData({ serviceSectorId: "s", level1: "s", deadlineDays: days })));
    expect(parse("30").success).toBe(true);
    expect(parse("31").success).toBe(false);
    expect(parse("dois").success).toBe(false);
    expect(parse("").success).toBe(true);
  });

  it("gives fixed messages for levels, condition and deadline", () => {
    const failure = (path: string) => serviceApprovalFailure(new ValidationError([{ path: [path], code: "custom" }]))?.message;
    expect(failure("sectorIds")).toContain("de 1 a 3 setores ativos");
    expect(failure("conditionFieldId")).toContain("condição válida");
    expect(failure("deadlineDays")).toContain("de 1 a 30 dias");
    expect(failure("name")).toBeUndefined();
    expect(serviceApprovalFailure(new Error("x"))).toBeNull();
  });

  it("summarizes the levels with sector names and the deadline", () => {
    expect(approvalSummary([], "purchasing", SECTORS, null)).toBe("1. Compras; sem prazo");
    expect(approvalSummary(["purchasing", "finance"], "purchasing", SECTORS, 2)).toBe("1. Compras → 2. Financeiro; 2 dias para cada nível");
    expect(approvalSummary(["gone"], "purchasing", SECTORS, 1)).toBe("1. setor inativo; 1 dia para cada nível");
  });
});

describe("absences messages of the administration (SF-167)", () => {
  it("knows its own codes only", () => {
    expect(absenceMessage("absence-registered")).toEqual({ text: "Ausência registrada.", error: false });
    expect(absenceMessage("absence-conflict")?.error).toBe(true);
    expect(absenceMessage("updated")).toBeNull();
    expect(absenceMessage(undefined)).toBeNull();
  });
});

describe("approval in the API (SF-167)", () => {
  const service = {
    id: "svc",
    sectorId: "purchasing",
    requiresApproval: true,
    approvalSectorIds: [] as string[],
    approvalDeadlineDays: null as number | null,
    approvalConditionFieldId: null as string | null,
    approvalConditionValue: null as string | null,
  };

  it("describes the service's approval, with the service's sector as the default level", () => {
    expect(serviceApprovalRepresentation(service as never)).toEqual({ levelSectorIds: ["purchasing"], deadlineDays: null, condition: null });
    expect(
      serviceApprovalRepresentation({
        ...service,
        approvalSectorIds: ["purchasing", "finance"],
        approvalDeadlineDays: 2,
        approvalConditionFieldId: "f",
        approvalConditionValue: "Sim",
      } as never),
    ).toEqual({ levelSectorIds: ["purchasing", "finance"], deadlineDays: 2, condition: { fieldId: "f", value: "Sim" } });
    expect(serviceApprovalRepresentation({ ...service, requiresApproval: false } as never)).toBeNull();
  });

  it("describes the progress and every decision of a request", () => {
    const now = new Date("2026-11-07T12:00:00.000Z");
    const request = {
      sectorId: "purchasing",
      approvalState: "PENDING",
      approvalSectorIdsSnapshot: ["purchasing", "finance"],
      approvalLevel: 2,
      approvalPendingSectorId: "finance",
      approvalDueAt: new Date(now.getTime() - 1000),
      approval: null,
      approvals: [
        {
          id: "d1",
          requestId: "r",
          deciderId: "paulo",
          decision: "APPROVED",
          note: null,
          decidedAt: new Date("2026-11-06T10:00:00.000Z"),
          decider: { id: "paulo", name: "Paulo" },
          level: 1,
          onBehalfOf: { id: "gabi", name: "Gabi" },
        },
      ],
    };
    expect(approvalProgressRepresentation(request as never, now)).toEqual({
      state: "PENDING",
      level: 2,
      levelCount: 2,
      levelSectorIds: ["purchasing", "finance"],
      pendingSectorId: "finance",
      dueAt: "2026-11-07T11:59:59.000Z",
      overdue: true,
    });
    expect(approvalDecisionsRepresentation(request as never)).toEqual([
      {
        level: 1,
        decision: "APPROVED",
        decider: { id: "paulo", name: "Paulo" },
        onBehalfOf: { id: "gabi", name: "Gabi" },
        note: null,
        decidedAt: "2026-11-06T10:00:00.000Z",
      },
    ]);
    expect(approvalProgressRepresentation({ ...request, approvalState: null } as never, now)).toBeNull();
  });
});
