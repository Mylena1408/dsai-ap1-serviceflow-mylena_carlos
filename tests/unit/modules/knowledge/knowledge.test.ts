import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { articleInputSchema, articleParagraphs, compareArticles } from "@/modules/knowledge/domain/article";
import type { ArticleRecord, ArticleStore, ArticleTransaction } from "@/modules/knowledge/application/articles";

const authorization = vi.hoisted(() => ({ requireCatalogEditor: vi.fn(), requirePublishedCatalogReader: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import {
  createArticle,
  deleteArticle,
  listArticlesForEditor,
  listPublishedArticles,
  setArticlePublished,
  updateArticle,
} from "@/modules/knowledge/application/articles";
import { KnowledgeArticles } from "@/app/_components/knowledge-editor";

// SPEC 2026-11-06-base-conhecimento, 4 (SF-156 and SF-157; CA-KB-01 to 03).

const serviceA = "11111111-1111-4111-8111-111111111111";
const articleId = "22222222-2222-4222-8222-222222222222";
const article = (overrides: Partial<ArticleRecord> = {}): ArticleRecord => ({
  id: articleId,
  serviceId: serviceA,
  title: "Como redefinir a senha",
  body: "Passo 1.\n\nPasso 2.",
  isPublished: false,
  position: 999,
  updatedAt: new Date(),
  updatedByName: "Admin",
  ...overrides,
});

describe("article rules (4.1 and 4.2)", () => {
  it("validates title, body and position", () => {
    expect(articleInputSchema.safeParse({ title: " Senha ", body: "Texto", position: "3" })).toMatchObject({ success: true, data: { title: "Senha", position: 3 } });
    for (const input of [
      { title: "", body: "x" },
      { title: "x".repeat(161), body: "x" },
      { title: "T", body: "  " },
      { title: "T", body: "x".repeat(20001) },
      { title: "T", body: "x", position: 1000 },
      { title: "T", body: "x", position: -1 },
      { title: "T", body: "x", extra: true },
    ]) {
      expect(articleInputSchema.safeParse(input).success).toBe(false);
    }
  });

  it("orders by position, then title, and splits paragraphs on blank lines", () => {
    const sorted = [article({ title: "b", position: 2 }), article({ title: "C", position: 1 }), article({ title: "a", position: 2 })].sort(compareArticles);
    expect(sorted.map(({ title }) => title)).toEqual(["C", "a", "b"]);
    expect(articleParagraphs("Um\nlinha\r\n\r\nDois\n\n\n\nTrês  ")).toEqual(["Um\nlinha", "Dois", "Três"]);
  });
});

function store(overrides: { serviceSector?: string | null; articleSector?: string | null; current?: ArticleRecord | null } = {}) {
  const calls: string[] = [];
  const transaction: ArticleTransaction = {
    audited: vi.fn(async (_meta, change) => change()),
    serviceSector: vi.fn(async () => (overrides.serviceSector === undefined ? "sector-a" : overrides.serviceSector)),
    articleSector: vi.fn(async () => (overrides.articleSector === undefined ? "sector-a" : overrides.articleSector)),
    find: vi.fn(async () => (overrides.current === undefined ? article() : overrides.current)),
    create: vi.fn(async () => {
      calls.push("create");
      return { id: articleId };
    }),
    update: vi.fn(async () => {
      calls.push("update");
      return { id: articleId };
    }),
    remove: vi.fn(async () => {
      calls.push("remove");
    }),
  } as unknown as ArticleTransaction;
  const value: ArticleStore = {
    run: async (work) => work(transaction),
    listForEditor: vi.fn(async () => [{ id: serviceA, name: "Acesso", sectorId: "sector-a", isActive: true, articles: [article({ title: "z", position: 5 }), article({ title: "a", position: 1 })] }]),
    listPublished: vi.fn(async () => [article({ isPublished: true, title: "b" }), article({ isPublished: true, title: "a" })]),
  };
  return { store: value, transaction, calls };
}

const admin = { actor: { id: "admin", role: "ADMIN", sectorId: null, isActive: true }, sectorId: null };
const holder = { actor: { id: "holder", role: "ATTENDANT", sectorId: "sector-a", isActive: true }, sectorId: "sector-a" };

describe("article use cases (4.3 to 4.5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorization.requireCatalogEditor.mockResolvedValue(admin);
  });

  it("creates a draft at the end by default, audited", async () => {
    const { store: value, transaction } = store();
    await createArticle(serviceA, { title: "Senha", body: "Texto" }, value);
    expect(transaction.create).toHaveBeenCalledWith({ serviceId: serviceA, title: "Senha", body: "Texto", position: 999, actorId: "admin" });
    expect(transaction.audited).toHaveBeenCalledWith(expect.objectContaining({ action: "CREATED", entityType: "KNOWLEDGE_ARTICLE" }), expect.any(Function));
  });

  it("lets a holder of the permission reach only the own sector", async () => {
    authorization.requireCatalogEditor.mockResolvedValue(holder);
    await expect(createArticle(serviceA, { title: "T", body: "x" }, store({ serviceSector: "sector-b" }).store)).rejects.toThrow(NotFoundError);
    await expect(updateArticle(articleId, { title: "T", body: "x" }, store({ articleSector: "sector-b" }).store)).rejects.toThrow(NotFoundError);
    const { store: own, calls } = store();
    await updateArticle(articleId, { title: "T", body: "x" }, own);
    expect(calls).toEqual(["update"]);
  });

  it("publishes and unpublishes, refusing the current state", async () => {
    const { store: draft, transaction } = store({ current: article({ isPublished: false }) });
    await setArticlePublished(articleId, true, draft);
    expect(transaction.update).toHaveBeenCalledWith(articleId, { isPublished: true, actorId: "admin" });
    await expect(setArticlePublished(articleId, false, draft)).rejects.toThrow(ConflictError);
  });

  it("deletes only drafts", async () => {
    const { store: published, calls } = store({ current: article({ isPublished: true }) });
    await expect(deleteArticle(articleId, published)).rejects.toThrow(ConflictError);
    expect(calls).toEqual([]);
    const { store: draft, calls: draftCalls } = store();
    await deleteArticle(articleId, draft);
    expect(draftCalls).toEqual(["remove"]);
  });

  it("refuses invalid input and people who are not catalog editors", async () => {
    await expect(createArticle(serviceA, { title: "", body: "x" }, store().store)).rejects.toThrow(ValidationError);
    authorization.requireCatalogEditor.mockRejectedValue(new AuthorizationError());
    await expect(listArticlesForEditor(store().store)).rejects.toThrow(AuthorizationError);
  });

  it("lists the editor's services with articles in display order, and the published ones for requesters", async () => {
    const editorView = await listArticlesForEditor(store().store);
    expect(editorView[0]!.articles.map(({ title }) => title)).toEqual(["a", "z"]);
    authorization.requirePublishedCatalogReader.mockResolvedValue({ id: "rita", role: "REQUESTER" });
    expect((await listPublishedArticles(serviceA, store().store)).map(({ title }) => title)).toEqual(["a", "b"]);
  });
});

describe("catalog block (4.2)", () => {
  it("renders closed articles with paragraphs as text, never HTML", () => {
    const html = renderToStaticMarkup(
      createElement(KnowledgeArticles, { articles: [article({ isPublished: true, body: "Primeiro <b>passo</b>.\n\nSegundo passo." })] }),
    );
    expect(html).toContain("Antes de abrir, veja se isto resolve");
    expect(html).toContain("<summary>Como redefinir a senha</summary>");
    expect(html).toContain("Primeiro &lt;b&gt;passo&lt;/b&gt;.");
    expect(html.match(/<p class="request-description">/g)).toHaveLength(2);
    expect(renderToStaticMarkup(createElement(KnowledgeArticles, { articles: [] }))).toBe("");
  });
});
