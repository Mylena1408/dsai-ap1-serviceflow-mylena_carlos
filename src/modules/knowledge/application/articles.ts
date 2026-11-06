import type { AuditScope } from "@/modules/audit";
import { requireCatalogEditor, requirePublishedCatalogReader, type AuthorizationActor } from "@/server/authorization";
import { ConflictError, NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";
import { articleInputSchema, compareArticles } from "../domain/article";

// Use cases of the knowledge base (SPEC 2026-11-06-base-conhecimento, 4): the catalog editors
// manage the articles of the services they reach; requesters read the published ones.

export interface ArticleRecord {
  id: string;
  serviceId: string;
  title: string;
  body: string;
  isPublished: boolean;
  position: number;
  updatedAt: Date;
  updatedByName: string;
}

export interface EditorService {
  id: string;
  name: string;
  sectorId: string;
  isActive: boolean;
  articles: ArticleRecord[];
}

export interface ArticleTransaction extends AuditScope {
  serviceSector(serviceId: string): Promise<string | null>;
  find(articleId: string): Promise<ArticleRecord | null>;
  articleSector(articleId: string): Promise<string | null>;
  create(input: { serviceId: string; title: string; body: string; position: number; actorId: string }): Promise<{ id: string }>;
  update(articleId: string, input: { title?: string; body?: string; position?: number; isPublished?: boolean; actorId: string }): Promise<{ id: string }>;
  remove(articleId: string): Promise<void>;
}

export interface ArticleStore {
  run<T>(work: (transaction: ArticleTransaction) => Promise<T>): Promise<T>;
  /** Services the editor reaches (every service, or one sector's), with all their articles. */
  listForEditor(sectorId: string | null): Promise<EditorService[]>;
  /** Published articles of a service the requester can see; empty otherwise. */
  listPublished(serviceId: string): Promise<ArticleRecord[]>;
}

async function editor() {
  const { actor, sectorId } = await requireCatalogEditor();
  return { actor, sectorId };
}

/** A null sector reaches every service (administrator); otherwise only that sector's (4.4). */
function reaches(scopeSectorId: string | null, sectorId: string | null): boolean {
  return sectorId !== null && (scopeSectorId === null || scopeSectorId === sectorId);
}

export async function listArticlesForEditor(store: ArticleStore): Promise<EditorService[]> {
  const { sectorId } = await editor();
  const services = await store.listForEditor(sectorId);
  return services.map((service) => ({ ...service, articles: [...service.articles].sort(compareArticles) }));
}

export async function createArticle(serviceId: unknown, input: unknown, store: ArticleStore): Promise<{ id: string }> {
  const { actor, sectorId } = await editor();
  const id = validateInput(entityIdSchema, serviceId);
  const parsed = validateInput(articleInputSchema, input);

  return store.run(async (transaction) => {
    if (!reaches(sectorId, await transaction.serviceSector(id))) throw new NotFoundError();
    return transaction.audited({ actor, action: "CREATED", entityType: "KNOWLEDGE_ARTICLE" }, () =>
      transaction.create({ serviceId: id, title: parsed.title, body: parsed.body, position: parsed.position ?? 999, actorId: actor.id }),
    );
  });
}

async function withOwnArticle<T>(articleId: unknown, store: ArticleStore, work: (transaction: ArticleTransaction, id: string, actor: AuthorizationActor) => Promise<T>) {
  const { actor, sectorId } = await editor();
  const id = validateInput(entityIdSchema, articleId);
  return store.run(async (transaction) => {
    if (!reaches(sectorId, await transaction.articleSector(id))) throw new NotFoundError();
    return work(transaction, id, actor);
  });
}

export async function updateArticle(articleId: unknown, input: unknown, store: ArticleStore): Promise<void> {
  const parsed = validateInput(articleInputSchema, input);
  await withOwnArticle(articleId, store, (transaction, id, actor) =>
    transaction.audited({ actor, action: "UPDATED", entityType: "KNOWLEDGE_ARTICLE", entityId: id }, () =>
      transaction.update(id, { title: parsed.title, body: parsed.body, ...(parsed.position === undefined ? {} : { position: parsed.position }), actorId: actor.id }),
    ),
  );
}

/** Publish or unpublish (4.3); a request for the current state is a conflict. */
export async function setArticlePublished(articleId: unknown, published: boolean, store: ArticleStore): Promise<void> {
  await withOwnArticle(articleId, store, async (transaction, id, actor) => {
    const article = await transaction.find(id);
    if (!article) throw new NotFoundError();
    if (article.isPublished === published) throw new ConflictError();
    return transaction.audited({ actor, action: "UPDATED", entityType: "KNOWLEDGE_ARTICLE", entityId: id }, () =>
      transaction.update(id, { isPublished: published, actorId: actor.id }),
    );
  });
}

/** Only drafts are removed (decision K5). */
export async function deleteArticle(articleId: unknown, store: ArticleStore): Promise<void> {
  await withOwnArticle(articleId, store, async (transaction, id, actor) => {
    const article = await transaction.find(id);
    if (!article) throw new NotFoundError();
    if (article.isPublished) throw new ConflictError();
    return transaction.audited({ actor, action: "DELETED", entityType: "KNOWLEDGE_ARTICLE", entityId: id }, async () => {
      await transaction.remove(id);
      return { id };
    });
  });
}

/** What the requester sees on the service page (4.2). */
export async function listPublishedArticles(serviceId: unknown, store: ArticleStore): Promise<ArticleRecord[]> {
  await requirePublishedCatalogReader();
  const id = validateInput(entityIdSchema, serviceId);
  return [...(await store.listPublished(id))].sort(compareArticles);
}
