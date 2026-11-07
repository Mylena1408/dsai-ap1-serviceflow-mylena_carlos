import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import type { RequestLinkView, RequestWithHistory } from "@/modules/requests";

const requests = vi.hoisted(() => ({ linkRequests: vi.fn(), unlinkRequests: vi.fn() }));
const navigation = vi.hoisted(() => ({
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("@/modules/requests", async (original) => ({ ...(await original<object>()), ...requests }));
vi.mock("next/navigation", () => navigation);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { RequestLinks, linkSummary } from "@/app/_components/request-links";
import { buildTimeline, linkEventTitle } from "@/app/_components/request-timeline";
import { linkRequestAction, unlinkRequestAction } from "@/app/(attendant)/queue/link-actions";
import { linkRepresentation } from "@/modules/public-api/domain/representation";

// SPEC 2026-11-07-operacao-e-automacao, 3.3 item 1 (SF-176; CA-VNC-01 to 03 on the screens and the API).

const A = "aaaaaaaa-1111-4111-8111-111111111111";
const B = "bbbbbbbb-2222-4222-8222-222222222222";
const noop = async (): Promise<never> => {
  throw new Error("not called");
};

const view = (overrides: Partial<RequestLinkView["other"]> = {}, role: RequestLinkView["role"] = "duplicate_of"): RequestLinkView => ({
  id: "l1",
  role,
  other: { id: B, serviceName: "Reparo", sectorName: "TI", status: "OPEN", readable: true, ...overrides },
});

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("the 'Vínculos' block", () => {
  it("summarizes a link with role, code, service, sector and status", () => {
    expect(linkSummary(view())).toBe("Duplicada de #BBBBBBBB · Reparo · TI · Aberta");
    expect(linkSummary(view({ status: "COMPLETED" }, "original_of"))).toBe("Original de #BBBBBBBB · Reparo · TI · Concluída");
  });

  it("links to the other request only when the reader may open it; the team gets the form and 'Remover'", () => {
    const html = renderToStaticMarkup(
      createElement(RequestLinks, {
        requestId: A,
        links: [view(), { ...view({ id: "cccccccc-3333-4333-8333-333333333333", readable: false, sectorName: "RH" }, "related"), id: "l2" }],
        hrefFor: (id: string) => `/queue/${id}`,
        edit: { linkAction: noop, unlinkAction: noop },
      }),
    );
    expect(html).toContain(`href="/queue/${B}"`);
    expect(html).not.toContain('href="/queue/cccccccc');
    expect(html).toContain("Relacionada a #CCCCCCCC · Reparo · RH · Aberta");
    expect(html).toContain('aria-label="Remover vínculo com #BBBBBBBB"');
    expect(html).toContain('aria-label="Vincular solicitação"');
    expect(html).toContain('<option value="DUPLICATE_OF">Esta é duplicada de</option>');
  });

  it("is read only for the requester and the manager, and absent without links", () => {
    const html = renderToStaticMarkup(createElement(RequestLinks, { requestId: A, links: [view()], hrefFor: (id: string) => `/requests/${id}` }));
    expect(html).toContain(`href="/requests/${B}"`);
    expect(html).not.toContain("Remover");
    expect(html).not.toContain("Vincular");
    expect(renderToStaticMarkup(createElement(RequestLinks, { requestId: A, links: [], hrefFor: String }))).toBe("");
  });
});

describe("links in the history", () => {
  it("names the link and its removal, and merges them in time order", () => {
    expect(linkEventTitle({ role: "duplicate_of", action: "LINKED", otherRequestId: B })).toBe("Vinculada como duplicada de #BBBBBBBB");
    expect(linkEventTitle({ role: "related", action: "UNLINKED", otherRequestId: B })).toBe("Vínculo removido: relacionada a #BBBBBBBB");

    const request = {
      events: [{ id: "s1", fromStatus: null, toStatus: "OPEN", occurredAt: new Date("2026-11-07T10:00:00Z"), actor: { id: "rita", name: "Rita" }, note: null }],
      assignmentEvents: [],
      priorityEvents: [],
      stageEvents: [],
      sectorEvents: [],
      fieldUpdates: [],
      slaPauses: [],
      approvals: [],
      approval: null,
    } as unknown as RequestWithHistory;
    const entries = buildTimeline(request, [
      { id: "e1", role: "related", action: "LINKED", otherRequestId: B, actor: { id: "ana", name: "Ana" }, occurredAt: new Date("2026-11-07T11:00:00Z") },
    ]);
    // The link came after the opening, so it is the last entry.
    expect(entries.length).toBeGreaterThan(1);
    expect(entries.at(-1)).toMatchObject({ title: "Vinculada como relacionada a #BBBBBBBB", actor: "Ana" });
    // Without link events the history is the same as before.
    expect(buildTimeline(request).some(({ id }) => id.startsWith("link-"))).toBe(false);
  });
});

describe("link actions of the queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requests.linkRequests.mockResolvedValue({ linkId: "l1" });
    requests.unlinkRequests.mockResolvedValue(undefined);
  });

  it("links and unlinks with the form values", async () => {
    await expect(linkRequestAction(form({ requestId: A, code: "#bbbbbbbb", kind: "DUPLICATE_OF" }))).rejects.toThrow(`REDIRECT:/queue/${A}?notice=linked`);
    expect(requests.linkRequests).toHaveBeenCalledWith({ requestId: A, code: "#bbbbbbbb", kind: "DUPLICATE_OF" });
    await expect(unlinkRequestAction(form({ requestId: A, linkId: "l1" }))).rejects.toThrow(`REDIRECT:/queue/${A}?notice=unlinked`);
    expect(requests.unlinkRequests).toHaveBeenCalledWith({ requestId: A, linkId: "l1" });
  });

  it("turns each refusal into the page's code", async () => {
    for (const [error, code] of [
      [new ValidationError([{ path: ["code"], code: "invalid_value" }]), "link-code"],
      [new NotFoundError(), "link-missing"],
      [new ConflictError(), "link-conflict"],
    ] as const) {
      requests.linkRequests.mockRejectedValueOnce(error);
      await expect(linkRequestAction(form({ requestId: A, code: "x", kind: "RELATED" }))).rejects.toThrow(`REDIRECT:/queue/${A}?error=${code}`);
    }
    requests.linkRequests.mockRejectedValueOnce(new Error("boom"));
    await expect(linkRequestAction(form({ requestId: A, code: "x", kind: "RELATED" }))).rejects.toThrow("boom");
  });
});

describe("links in the API", () => {
  it("gives the relation, the other request's code, service, sector and status, and whether it is accessible", () => {
    expect(linkRepresentation(view({ readable: false }, "original_of"))).toEqual({
      id: "l1",
      relation: "original_of",
      request: { id: B, code: "BBBBBBBB", service: "Reparo", sector: "TI", status: "OPEN", accessible: false },
    });
  });
});
