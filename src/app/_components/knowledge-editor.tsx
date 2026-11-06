import {
  MAX_ARTICLE_BODY_LENGTH,
  MAX_ARTICLE_POSITION,
  MAX_ARTICLE_TITLE_LENGTH,
  articleParagraphs,
  type ArticleRecord,
  type EditorService,
} from "@/modules/knowledge";
import { createArticleAction, deleteArticleAction, publishArticleAction, updateArticleAction } from "./knowledge-actions";

// Knowledge base editor and reader (SPEC 2026-11-06-base-conhecimento, 2 and 4): the editor for
// the administrator and the holders of "Gerir serviços do setor"; the reader on the catalog.

const MESSAGES: Record<string, { text: string; error: boolean }> = {
  "article-created": { text: "Artigo criado como rascunho.", error: false },
  "article-updated": { text: "Artigo alterado.", error: false },
  "article-published": { text: "Artigo publicado. Os solicitantes já o veem no catálogo.", error: false },
  "article-unpublished": { text: "Artigo despublicado.", error: false },
  "article-deleted": { text: "Rascunho excluído.", error: false },
  "article-invalid": {
    text: `Informe um título de até ${MAX_ARTICLE_TITLE_LENGTH} caracteres, um texto de até ${MAX_ARTICLE_BODY_LENGTH.toLocaleString("pt-BR")} caracteres e uma posição de 0 a ${MAX_ARTICLE_POSITION}.`,
    error: true,
  },
  "article-conflict": { text: "Não foi possível: já existe um artigo com esse título no serviço, ou o artigo está publicado (despublique antes de excluir).", error: true },
  "article-missing": { text: "Artigo ou serviço não encontrado.", error: true },
};

function ArticleFields({ article, idSuffix }: { article?: ArticleRecord; idSuffix: string }) {
  return (
    <>
      <label htmlFor={`article-title-${idSuffix}`}>Título</label>
      <input id={`article-title-${idSuffix}`} name="title" required maxLength={MAX_ARTICLE_TITLE_LENGTH} defaultValue={article?.title} />
      <label htmlFor={`article-body-${idSuffix}`}>Texto (uma linha em branco separa os parágrafos)</label>
      <textarea id={`article-body-${idSuffix}`} name="body" required maxLength={MAX_ARTICLE_BODY_LENGTH} rows={6} defaultValue={article?.body} />
      <label htmlFor={`article-position-${idSuffix}`}>Posição (0 a {MAX_ARTICLE_POSITION}; menor aparece antes)</label>
      <input id={`article-position-${idSuffix}`} name="position" type="number" min={0} max={MAX_ARTICLE_POSITION} defaultValue={article?.position ?? ""} />
    </>
  );
}

export function KnowledgeEditor({
  services,
  returnTo,
  notice,
}: {
  services: readonly EditorService[];
  returnTo: "/admin?section=knowledge" | "/sector-services";
  notice?: string;
}) {
  const message = notice ? MESSAGES[notice] : undefined;
  return (
    <section id="knowledge" className="admin-section" aria-labelledby="knowledge-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Catálogo</p>
          <h2 id="knowledge-heading">Base de conhecimento</h2>
          <p className="section-description">
            Artigos que o solicitante vê na página do serviço antes de abrir uma solicitação. Todo artigo nasce como rascunho.
          </p>
        </div>
      </div>
      {message ? (
        <p className={`feedback${message.error ? " feedback-error" : ""}`} role={message.error ? "alert" : "status"}>
          {message.text}
        </p>
      ) : null}
      {services.length === 0 ? <p className="metadata">Nenhum serviço disponível.</p> : null}
      <ul className="entity-list">
        {services.map((service) => (
          <li key={service.id} className="entity-item">
            <details>
              <summary>
                {service.name}
                {service.isActive ? null : " (inativo)"} · {service.articles.length} {service.articles.length === 1 ? "artigo" : "artigos"}
              </summary>
              {service.articles.map((article) => (
                <article key={article.id} className="knowledge-article-editor" aria-label={article.title}>
                  <h3>
                    {article.title} <span className="status-pill">{article.isPublished ? "Publicado" : "Rascunho"}</span>
                  </h3>
                  <p className="metadata">
                    Posição {article.position} · alterado por {article.updatedByName} em{" "}
                    {article.updatedAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}
                  </p>
                  <details>
                    <summary>Editar</summary>
                    <form action={updateArticleAction} className="request-form">
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <input type="hidden" name="id" value={article.id} />
                      <ArticleFields article={article} idSuffix={article.id} />
                      <button type="submit">Salvar artigo</button>
                    </form>
                  </details>
                  <div className="knowledge-actions">
                    <form action={publishArticleAction}>
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <input type="hidden" name="id" value={article.id} />
                      <input type="hidden" name="publish" value={article.isPublished ? "false" : "true"} />
                      <button className="button-secondary" type="submit">
                        {article.isPublished ? "Despublicar" : "Publicar"}
                      </button>
                    </form>
                    {article.isPublished ? null : (
                      <form action={deleteArticleAction}>
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <input type="hidden" name="id" value={article.id} />
                        <button className="button-danger" type="submit">
                          Excluir rascunho
                        </button>
                      </form>
                    )}
                  </div>
                </article>
              ))}
              <form action={createArticleAction} className="request-form" aria-label={`Novo artigo de ${service.name}`}>
                <input type="hidden" name="returnTo" value={returnTo} />
                <input type="hidden" name="serviceId" value={service.id} />
                <h3>Novo artigo</h3>
                <ArticleFields idSuffix={`new-${service.id}`} />
                <button type="submit">Criar rascunho</button>
              </form>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The catalog block (4.2): published articles, closed, plain text in paragraphs. */
export function KnowledgeArticles({ articles }: { articles: readonly ArticleRecord[] }) {
  if (articles.length === 0) return null;
  return (
    <section className="surface-card" aria-labelledby="knowledge-before">
      <h2 id="knowledge-before">Antes de abrir, veja se isto resolve</h2>
      {articles.map((article) => (
        <details key={article.id} className="knowledge-article">
          <summary>{article.title}</summary>
          {articleParagraphs(article.body).map((paragraph, index) => (
            <p key={index} className="request-description">
              {paragraph}
            </p>
          ))}
        </details>
      ))}
    </section>
  );
}
