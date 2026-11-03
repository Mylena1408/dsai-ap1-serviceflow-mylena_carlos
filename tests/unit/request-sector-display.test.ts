import { describe, expect, it, vi } from "vitest";

// The notification component reads the unread count through the module; only its messages are tested here.
vi.mock("@/modules/notifications", () => ({ countUnreadNotifications: vi.fn() }));
import { buildTimeline } from "@/app/_components/request-timeline";
import { notificationMessage } from "@/app/_components/notifications";
import { plannedNotifications } from "@/modules/notifications/domain/recipients";
import { notificationCategory } from "@/modules/notifications/domain/email";
import { buildPersonalDataExport, type PersonalDataSource } from "@/modules/audit/domain/personal-data";
import type { RequestWithHistory } from "@/modules/requests";

// SPEC 2026-11-03-transferencia-entre-setores, 5.5, 5.6 and 5.9 (SF-121).

const at = (minute: number) => new Date(`2026-11-03T12:${String(minute).padStart(2, "0")}:00.000Z`);
const ana = { id: "ana", name: "Ana" };

describe("a move in the timeline (5.5)", () => {
  it("shows both sector names, the author and the reason, before the release made by the move", () => {
    const request = {
      events: [
        { id: "s1", requestId: "r", actorId: "rita", fromStatus: null, toStatus: "OPEN", occurredAt: at(0), note: null, actor: { id: "rita", name: "Rita", email: "r@example.test" } },
      ],
      assignmentEvents: [
        { id: "a1", requestId: "r", actorId: ana.id, fromAssigneeId: null, toAssigneeId: ana.id, occurredAt: at(1), actor: ana, fromAssignee: null, toAssignee: ana },
        { id: "a2", requestId: "r", actorId: ana.id, fromAssigneeId: ana.id, toAssigneeId: null, occurredAt: at(2), actor: ana, fromAssignee: ana, toAssignee: null },
      ],
      priorityEvents: [],
      stageEvents: [],
      sectorEvents: [
        {
          id: "m1",
          requestId: "r",
          actorId: ana.id,
          fromSectorId: "s-a",
          toSectorId: "s-b",
          fromSectorName: "Atendimento",
          toSectorName: "Manutenção",
          note: "Pedido é da manutenção",
          occurredAt: at(2),
          actor: ana,
        },
      ],
    } as unknown as RequestWithHistory;

    expect(buildTimeline(request).map(({ title, actor, note }) => [title, actor, note])).toEqual([
      ["Solicitação aberta: Aberta", "Rita", null],
      ["Assumida por Ana", "Ana", null],
      ["Encaminhada do setor Atendimento para o setor Manutenção", "Ana", "Pedido é da manutenção"],
      ["Liberada por Ana", "Ana", null],
    ]);
  });

  it("keeps requests without the new list working", () => {
    const request = { events: [], assignmentEvents: [], priorityEvents: [], stageEvents: [] } as unknown as RequestWithHistory;
    expect(buildTimeline(request)).toEqual([]);
  });
});

describe("notifications of a move (5.6)", () => {
  const event = { type: "request.sector_changed" as const, payload: { toSectorId: "s-b", actorId: "ana" } };

  it("reaches the receiving team and the requester, never the author", () => {
    expect(
      plannedNotifications(event, { requesterId: "rita", effectiveAssigneeId: null, receivingAttendantIds: ["caio", "ana", "eva"] }),
    ).toEqual([
      { recipientId: "caio", type: "sector.received" },
      { recipientId: "eva", type: "sector.received" },
      { recipientId: "rita", type: "sector.changed" },
    ]);
    expect(plannedNotifications(event, { requesterId: "rita", effectiveAssigneeId: null })).toEqual([
      { recipientId: "rita", type: "sector.changed" },
    ]);
  });

  it("uses the transfer and status email categories and texts without the reason", () => {
    expect(notificationCategory("sector.received")).toBe("ASSIGNMENT");
    expect(notificationCategory("sector.changed")).toBe("STATUS");
    expect(notificationMessage({ type: "sector.received", serviceName: "Reparo elétrico" })).toBe(
      "Solicitação encaminhada ao seu setor: Reparo elétrico",
    );
    expect(notificationMessage({ type: "sector.changed", serviceName: "Reparo elétrico" })).toBe(
      "Solicitação encaminhada a outro setor: Reparo elétrico",
    );
  });
});

describe("moves in \"Meus dados\" (5.9)", () => {
  const request: PersonalDataSource["requests"][number] = {
    id: "3f2a9c1e-0000-4000-8000-000000000001",
    serviceName: "Reparo elétrico",
    categoryName: "Manutenção",
    sectorName: "Manutenção",
    description: "A tomada não funciona.",
    status: "OPEN",
    priority: "NORMAL",
    approvalState: null,
    createdAt: at(0),
    completedAt: null,
    cancelledAt: null,
    dueAt: null,
    answers: [],
    history: [],
    comments: [],
    attachments: [],
  };
  const source = (requests: PersonalDataSource["requests"]): PersonalDataSource => ({
    person: { name: "Rita", email: "rita@exemplo.test", role: "REQUESTER", sectorName: null, isActive: true, createdAt: at(0), updatedAt: at(0) },
    emailCategories: [],
    requests,
    writtenElsewhere: [],
    notifications: [],
    permissions: [],
  });

  it("lists the moves of the person's requests with the reason, and nothing for requests that never moved", () => {
    const moved = buildPersonalDataExport(
      source([
        {
          ...request,
          sectorMoves: [{ occurredAt: at(2), fromSectorName: "Atendimento", toSectorName: "Manutenção", actorName: "Ana", note: "Pedido é da manutenção" }],
        },
      ]),
      at(5),
    );
    expect(moved.solicitacoesQueVoceAbriu[0]).toMatchObject({
      encaminhamentos: [
        { quando: at(2).toISOString(), de: "Atendimento", para: "Manutenção", por: "Ana", justificativa: "Pedido é da manutenção" },
      ],
    });

    const still = buildPersonalDataExport(source([{ ...request, sectorMoves: [] }]), at(5));
    expect(still.solicitacoesQueVoceAbriu[0]).not.toHaveProperty("encaminhamentos");
  });
});
