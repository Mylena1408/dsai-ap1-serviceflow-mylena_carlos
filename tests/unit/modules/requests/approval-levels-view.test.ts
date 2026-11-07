import { describe, expect, it } from "vitest";
import { approvalLevelText, approvalLevelsView } from "@/modules/requests/domain/approval-levels-view";
import type { RequestApprovalRecord } from "@/modules/requests/domain/request";

// SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.3 to 4.3.6 (SF-167): the levels on screen.

const NOW = new Date("2026-11-07T12:00:00.000Z");
const names = new Map([
  ["purchasing", "Compras"],
  ["finance", "Financeiro"],
  ["board", "Diretoria"],
]);

function decision(level: number, value: "APPROVED" | "REJECTED", extra: Partial<RequestApprovalRecord> = {}): RequestApprovalRecord {
  return {
    id: `d${level}`,
    requestId: "r",
    deciderId: "gabi",
    decision: value,
    note: null,
    decidedAt: new Date("2026-11-06T10:00:00.000Z"),
    decider: { id: "gabi", name: "Gabi" },
    level,
    ...extra,
  };
}

const base = {
  sectorId: "purchasing",
  approvalSectorIdsSnapshot: ["purchasing", "finance", "board"],
  approval: null,
  approvals: [] as RequestApprovalRecord[],
};

describe("approval levels view (SF-167)", () => {
  it("is null without approval", () => {
    expect(approvalLevelsView({ ...base, approvalState: null, approvalLevel: null, approvalDueAt: null }, names, NOW)).toBeNull();
  });

  it("shows decided, pending (with its deadline and delay) and waiting levels", () => {
    const view = approvalLevelsView(
      {
        ...base,
        approvalState: "PENDING",
        approvalLevel: 2,
        approvalDueAt: new Date(NOW.getTime() - 1000),
        approvals: [decision(1, "APPROVED", { onBehalfOf: { id: "paulo", name: "Paulo" } })],
      },
      names,
      NOW,
    )!;

    expect(view.levelCount).toBe(3);
    expect(view.lines.map(({ level, sectorName, situation, overdue }) => ({ level, sectorName, situation, overdue }))).toEqual([
      { level: 1, sectorName: "Compras", situation: "approved", overdue: false },
      { level: 2, sectorName: "Financeiro", situation: "pending", overdue: true },
      { level: 3, sectorName: "Diretoria", situation: "waiting", overdue: false },
    ]);
    expect(view.lines[1]!.dueAt).toEqual(new Date(NOW.getTime() - 1000));
    expect(view.lines.map(approvalLevelText)).toEqual([
      "Aprovado por Gabi, substituindo Paulo",
      "Aguardando decisão — atrasado",
      "Aguardando o nível anterior",
    ]);
  });

  it("marks the levels after a rejection as never reached", () => {
    const view = approvalLevelsView(
      {
        ...base,
        approvalState: "REJECTED",
        approvalLevel: 2,
        approvalDueAt: null,
        approvals: [decision(1, "APPROVED"), decision(2, "REJECTED", { note: "Sem verba" })],
      },
      names,
      NOW,
    )!;
    expect(view.lines.map(({ situation }) => situation)).toEqual(["approved", "rejected", "not_reached"]);
    expect(view.lines[1]!.note).toBe("Sem verba");
  });

  it("reads requests opened before levels as one level of their sector, and names unknown sectors", () => {
    const legacy = approvalLevelsView(
      { sectorId: "purchasing", approvalState: "APPROVED", approvalLevel: null, approvalDueAt: null, approval: decision(1, "APPROVED", { level: undefined }) },
      names,
      NOW,
    )!;
    expect(legacy.lines).toEqual([expect.objectContaining({ level: 1, sectorName: "Compras", situation: "approved", decider: "Gabi" })]);

    const unknown = approvalLevelsView(
      { ...base, approvalSectorIdsSnapshot: ["gone"], approvalState: "PENDING", approvalLevel: 1, approvalDueAt: null },
      names,
      NOW,
    )!;
    expect(unknown.lines[0]!.sectorName).toBe("Setor removido");
  });
});
