import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/server/errors";

const authorization = vi.hoisted(() => ({ actor: { id: "ana", role: "ATTENDANT", isActive: true, sectorId: "s" } as { id: string; role: string } }));
vi.mock("@/server/authorization", () => ({ requireCurrentActor: vi.fn(async () => authorization.actor) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { normalizedCriteria, viewHref, MAX_VIEWS_PER_LIST, type SavedViewRecord } from "@/modules/saved-views";
import { deleteView, listSavedViews, renameView, saveView, type SavedViewStore } from "@/modules/saved-views/application/saved-views";
import { SavedViews, savedViewMessage } from "@/app/_components/saved-views";

// SPEC 2026-11-07-operacao-e-automacao, 7.3 item 1 (SF-191; CA-LOT-01 and 02 by the rules and the screen).

const VIEW = "11111111-1111-4111-8111-111111111111";

describe("normalized criteria (7.3 item 1)", () => {
  it("keeps only the list's parameters, in a fixed order, without blanks or the page", () => {
    expect(
      normalizedCriteria("QUEUE", { page: "3", order: "oldest", status: ["OPEN", "IN_PROGRESS", "OPEN"], q: " impressora ", assignee: "", view: "view-saved", sla: "due" }),
    ).toBe("q=impressora&status=IN_PROGRESS&status=OPEN&sla=due&order=oldest");
    expect(normalizedCriteria("MY_REQUESTS", "?q=x&assignee=me&stage=__none__&from=2026-11-01")).toBe("q=x&from=2026-11-01");
    expect(normalizedCriteria("MY_REQUESTS", {})).toBe("");
  });

  it("opens a view on its list", () => {
    expect(viewHref("QUEUE", "status=OPEN")).toBe("/queue?status=OPEN");
    expect(viewHref("MY_REQUESTS", "")).toBe("/requests");
  });
});

function store(views: Array<SavedViewRecord & { userId: string }> = []): SavedViewStore {
  return {
    list: vi.fn(async (userId, list) => views.filter((view) => view.userId === userId && view.list === list)),
    count: vi.fn(async (userId, list) => views.filter((view) => view.userId === userId && view.list === list).length),
    find: vi.fn(async (id) => views.find((view) => view.id === id) ?? null),
    create: vi.fn(async (view) => (views.some((item) => item.userId === view.userId && item.list === view.list && item.name.toLowerCase() === view.name.toLowerCase()) ? null : { id: VIEW, ...view })),
    rename: vi.fn(async () => true),
    remove: vi.fn(async () => {}),
  };
}

describe("saving and managing views (7.3 item 1; CA-LOT-02)", () => {
  it("each list is for whoever uses it: the queue for attendants, 'Minhas solicitações' for requesters", async () => {
    authorization.actor = { id: "ana", role: "ATTENDANT" };
    await expect(listSavedViews("MY_REQUESTS", store())).rejects.toBeInstanceOf(AuthorizationError);
    await expect(listSavedViews("QUEUE", store())).resolves.toEqual([]);
    authorization.actor = { id: "rita", role: "REQUESTER" };
    await expect(saveView({ list: "QUEUE", name: "Abertas", criteria: "status=OPEN" }, store())).rejects.toBeInstanceOf(AuthorizationError);
    authorization.actor = { id: "gabi", role: "MANAGER" };
    await expect(listSavedViews("QUEUE", store())).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("saves the normalized criteria under a name of 1 to 40 characters, unique per list, up to 20", async () => {
    authorization.actor = { id: "ana", role: "ATTENDANT" };
    const target = store();
    await expect(saveView({ list: "QUEUE", name: "  Abertas  ", criteria: "?page=2&status=OPEN&q=rede" }, target)).resolves.toMatchObject({ name: "Abertas", criteria: "q=rede&status=OPEN" });

    for (const name of ["", " ", "x".repeat(41)]) {
      await expect(saveView({ list: "QUEUE", name, criteria: "" }, store())).rejects.toBeInstanceOf(ValidationError);
    }
    const existing = [{ id: VIEW, userId: "ana", list: "QUEUE" as const, name: "Abertas", criteria: "" }];
    await expect(saveView({ list: "QUEUE", name: "ABERTAS", criteria: "" }, store(existing))).rejects.toBeInstanceOf(ConflictError);
    const full = Array.from({ length: MAX_VIEWS_PER_LIST }, (_, index) => ({ ...existing[0], id: `v${index}`, name: `Visão ${index}` }));
    await expect(saveView({ list: "QUEUE", name: "Mais uma", criteria: "" }, store(full))).rejects.toMatchObject({ issues: [{ path: [], code: "too_big" }] });
    await expect(saveView({ list: "QUEUE", name: "Longa", criteria: `q=${"x".repeat(1_000)}` }, store())).rejects.toMatchObject({ issues: [{ path: [], code: "too_big" }] });
  });

  it("only the person renames and deletes their views", async () => {
    const views = [{ id: VIEW, userId: "ana", list: "QUEUE" as const, name: "Abertas", criteria: "" }];
    authorization.actor = { id: "bia", role: "ATTENDANT" };
    await expect(renameView(VIEW, "Minhas", store(views))).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteView(VIEW, store(views))).rejects.toBeInstanceOf(NotFoundError);

    authorization.actor = { id: "ana", role: "ATTENDANT" };
    const target = store(views);
    await renameView(VIEW, " Minhas ", target);
    expect(target.rename).toHaveBeenCalledWith(VIEW, "Minhas");
    await deleteView(VIEW, target);
    expect(target.remove).toHaveBeenCalledWith(VIEW);
    await expect(renameView(VIEW, "", target)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("the screen (7.3 item 1; CA-LOT-01)", () => {
  it("lists the views, marks the one on screen, and saves the current search", () => {
    const html = renderToStaticMarkup(
      createElement(SavedViews, {
        list: "QUEUE",
        params: { status: "OPEN", page: "2" },
        views: [
          { id: VIEW, list: "QUEUE", name: "Abertas", criteria: "status=OPEN" },
          { id: "22222222-2222-4222-8222-222222222222", list: "QUEUE", name: "Todas", criteria: "" },
        ],
      }),
    );
    expect(html).toContain('href="/queue?status=OPEN"');
    expect(html).toContain('aria-current="page"');
    expect(html.match(/aria-current/g)).toHaveLength(1);
    expect(html).toContain('href="/queue"');
    expect(html).toContain('type="hidden" name="back" value="status=OPEN"');
    expect(html).toContain("Salvar esta busca");
  });

  it("invites to save when there is none, and explains each result", () => {
    const html = renderToStaticMarkup(createElement(SavedViews, { list: "MY_REQUESTS", params: {}, views: [] }));
    expect(html).toContain("Salve uma busca para voltar a ela com um clique.");
    expect(savedViewMessage("view-saved")).toEqual({ text: "Visão salva.", error: false });
    expect(savedViewMessage("view-taken")?.error).toBe(true);
    expect(savedViewMessage(["view-saved"])).toBeNull();
  });
});
