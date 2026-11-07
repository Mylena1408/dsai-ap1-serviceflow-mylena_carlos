import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError } from "@/server/errors";
import { groupCancellationSchema, groupProgress, groupProgressText, groupStateLabel } from "@/modules/requests/domain/request-group";
import type { GroupMemberRecord, GroupReader, GroupRecord } from "@/modules/requests/application/groups";

const authorization = vi.hoisted(() => ({ actor: null as unknown }));
vi.mock("@/server/authorization", async () => {
  const policy = await import("@/server/authorization/policy");
  return {
    assertRequestReadable: policy.assertRequestReadable,
    requireCurrentActor: vi.fn(async () => authorization.actor),
    actorHasPermission: vi.fn(async () => false),
  };
});

import { cancelGroup, getRequestGroupBlock, getRequesterGroup, listRequesterGroupLabels } from "@/modules/requests/application/groups";
import { RequestGroupBlock, groupMemberSummary } from "@/app/_components/request-group";
import { cancellationMessage, countParam, groupErrorMessage } from "@/app/(requester)/requests/groups/group-messages";
import { groupRepresentation } from "@/modules/public-api/domain/representation";

// SPEC 2026-11-07-operacao-e-automacao, 3.3 item 4 (SF-179; CA-VNC-06 by the rules and the screens).

const G = "99999999-9999-4999-8999-999999999999";
const A = "aaaaaaaa-1111-4111-8111-111111111111";
const B = "bbbbbbbb-2222-4222-8222-222222222222";
const C = "cccccccc-3333-4333-8333-333333333333";
const rita = { id: "rita", role: "REQUESTER" as const, isActive: true, sectorId: null };

const member = (id: string, overrides: Partial<GroupMemberRecord> = {}): GroupMemberRecord => ({
  id,
  requesterId: "rita",
  sectorId: "ti",
  serviceName: `Serviço ${id.slice(0, 1).toUpperCase()}`,
  sectorName: "TI",
  status: "OPEN",
  approvalState: null,
  approvalSectorIds: [],
  ...overrides,
});

const group = (requests: GroupMemberRecord[], overrides: Partial<GroupRecord> = {}): GroupRecord => ({
  id: G,
  bundleName: "Admissão",
  requesterId: "rita",
  createdAt: new Date("2026-11-07T12:00:00Z"),
  requests,
  ...overrides,
});

function reader(found: GroupRecord | null): GroupReader {
  return {
    findGroup: vi.fn(async () => found),
    findGroupOfRequest: vi.fn(async () => found),
    groupsOfRequests: vi.fn(async () => (found ? found.requests.map(({ id }) => ({ requestId: id, groupId: found.id, bundleName: found.bundleName })) : [])),
  };
}

beforeEach(() => {
  authorization.actor = rita;
});

describe("progress of a group (3.3 item 4)", () => {
  it("counts completed and cancelled, and closes when every request ended", () => {
    const open = groupProgress([{ status: "COMPLETED" }, { status: "IN_PROGRESS" }, { status: "CANCELLED" }]);
    expect(open).toEqual({ total: 3, completed: 1, cancelled: 1, closed: false });
    expect(groupProgressText(open)).toBe("1 de 3 concluída · 1 cancelada");
    expect(groupStateLabel(open)).toBe("Em andamento");
    const closed = groupProgress([{ status: "COMPLETED" }, { status: "COMPLETED" }]);
    expect(groupProgressText(closed)).toBe("2 de 2 concluídas");
    expect(groupStateLabel(closed)).toBe("Encerrado");
    expect(groupProgressText(groupProgress([{ status: "CANCELLED" }, { status: "CANCELLED" }, { status: "OPEN" }]))).toBe("0 de 3 concluídas · 2 canceladas");
  });

  it("reads the cancellation input with an optional reason", () => {
    expect(groupCancellationSchema.parse({ groupId: G, note: "  " })).toEqual({ groupId: G, note: null });
    expect(groupCancellationSchema.parse({ groupId: G, note: " Mudou a data " })).toEqual({ groupId: G, note: "Mudou a data" });
    expect(groupCancellationSchema.safeParse({ groupId: "x" }).success).toBe(false);
  });
});

describe("the requester's group", () => {
  it("shows the group to its requester only", async () => {
    const found = group([member(A), member(B, { status: "IN_PROGRESS" })]);
    await expect(getRequesterGroup(G, reader(found))).resolves.toMatchObject({
      id: G,
      bundleName: "Admissão",
      progress: { total: 2, completed: 0 },
      cancellable: true,
      requests: [{ id: A }, { id: B }],
    });
    await expect(getRequesterGroup(G, reader(group([], { requesterId: "rui" })))).rejects.toThrow(NotFoundError);
    await expect(getRequesterGroup(G, reader(null))).rejects.toThrow(NotFoundError);
    authorization.actor = { id: "ana", role: "ATTENDANT", isActive: true, sectorId: "ti" };
    await expect(getRequesterGroup(G, reader(found))).rejects.toThrow(NotFoundError);
  });

  it("cancels each open request by the same rule, and keeps the others with the reason", async () => {
    const found = group([member(A), member(B, { status: "IN_PROGRESS" }), member(C)]);
    const cancel = vi.fn(async (requestId: string) => {
      if (requestId === C) throw new ConflictError(); // started meanwhile
    });
    await expect(cancelGroup({ groupId: G, note: "Mudou a data" }, reader(found), cancel)).resolves.toEqual({
      cancelled: [A],
      kept: [
        { requestId: B, reason: "not_open" },
        { requestId: C, reason: "changed" },
      ],
    });
    expect(cancel).toHaveBeenCalledWith(A, "Mudou a data");
    expect(cancel).not.toHaveBeenCalledWith(B, expect.anything());

    const failing = vi.fn(async () => {
      throw new Error("database down");
    });
    await expect(cancelGroup({ groupId: G }, reader(group([member(A)])), failing)).rejects.toThrow("database down");
    await expect(cancelGroup({ groupId: G }, reader(group([member(A)], { requesterId: "rui" })), cancel)).rejects.toThrow(NotFoundError);
  });

  it("labels only the requester's own requests on the list", async () => {
    const found = group([member(A)]);
    await expect(listRequesterGroupLabels([A], reader(found))).resolves.toEqual(new Map([[A, { groupId: G, bundleName: "Admissão" }]]));
    await expect(listRequesterGroupLabels([], reader(found))).resolves.toEqual(new Map());
    authorization.actor = { id: "ana", role: "ATTENDANT", isActive: true, sectorId: "ti" };
    await expect(listRequesterGroupLabels([A], reader(found))).resolves.toEqual(new Map());
  });
});

describe("the 'Pacote' block (decision H4)", () => {
  const scope = { findRequestScope: vi.fn(async () => ({ requesterId: "rita", sectorId: "ti", requiresApproval: false, approvalSectorIds: [] })) };

  it("lists the other requests, opening only the ones the reader may read", async () => {
    authorization.actor = { id: "ana", role: "ATTENDANT", isActive: true, sectorId: "ti" };
    const found = group([member(A), member(B, { sectorId: "rh", sectorName: "RH" }), member(C, { status: "COMPLETED" })]);
    const block = await getRequestGroupBlock(A, scope, reader(found));
    expect(block).toEqual({
      groupId: G,
      bundleName: "Admissão",
      progress: { total: 3, completed: 1, cancelled: 0, closed: false },
      others: [
        { id: B, serviceName: "Serviço B", sectorName: "RH", status: "OPEN", readable: false },
        { id: C, serviceName: "Serviço C", sectorName: "TI", status: "COMPLETED", readable: true },
      ],
    });
    await expect(getRequestGroupBlock(A, scope, reader(null))).resolves.toBeNull();

    const html = renderToStaticMarkup(createElement(RequestGroupBlock, { block, hrefFor: (id: string) => `/queue/${id}` }));
    expect(html).toContain("Pacote: Admissão");
    expect(html).toContain("1 de 3 concluída");
    expect(html).toContain(`href="/queue/${C}"`);
    expect(html).not.toContain(`href="/queue/${B}"`);
    expect(groupMemberSummary(block!.others[0])).toBe("#BBBBBBBB · Serviço B · RH · Aberta");
    expect(renderToStaticMarkup(createElement(RequestGroupBlock, { block: null, hrefFor: String }))).toBe("");

    expect(groupRepresentation(block!)).toEqual({
      id: G,
      name: "Admissão",
      completed: 1,
      cancelled: 0,
      total: 3,
      closed: false,
      otherRequests: [
        { id: B, code: "BBBBBBBB", service: "Serviço B", sector: "RH", status: "OPEN", accessible: false },
        { id: C, code: "CCCCCCCC", service: "Serviço C", sector: "TI", status: "COMPLETED", accessible: true },
      ],
    });
  });
});

describe("messages of the group page", () => {
  it("says how many were cancelled and how many stay", () => {
    expect(cancellationMessage(2, 0)).toBe("2 solicitações canceladas.");
    expect(cancellationMessage(1, 1)).toBe("1 solicitação cancelada. 1 solicitação continua como estava, porque já está em atendimento ou encerrada.");
    expect(cancellationMessage(0, 3)).toBe("Nenhuma solicitação foi cancelada. 3 solicitações continuam como estavam, porque já estão em atendimento ou encerradas.");
    expect(countParam("2")).toBe(2);
    expect(countParam("x")).toBeNull();
    expect(countParam(undefined)).toBeNull();
    expect(groupErrorMessage("missing")).toContain("não está disponível");
    expect(groupErrorMessage(undefined)).toBeNull();
  });
});
