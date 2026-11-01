import { MAX_COMMENT_LENGTH, type CommentRecord } from "@/modules/comments";

type RequestConversationProps = {
  requestId: string;
  comments: CommentRecord[];
  /** Cancelled requests keep the conversation read-only (decision C1). */
  canWrite: boolean;
  /** Attendants may mark a comment as an internal note (decision C3). */
  allowInternal: boolean;
  action: (formData: FormData) => Promise<never>;
};

const roleLabels = {
  REQUESTER: "solicitante",
  ATTENDANT: "atendente",
  ADMIN: "administrador",
  MANAGER: "gestor",
} as const;

// Conversation of a request (SPEC 2026-10-31-comentarios, section 5.5). Text is rendered by
// React as plain text, never as HTML.
export function RequestConversation({
  requestId,
  comments,
  canWrite,
  allowInternal,
  action,
}: RequestConversationProps) {
  return (
    <section id="conversa" className="surface-card content-section" aria-labelledby="conversation-heading">
      <p className="eyebrow">Mensagens</p>
      <h2 id="conversation-heading">Conversa</h2>
      {comments.length === 0 ? (
        <p className="empty-state">Nenhum comentário ainda.</p>
      ) : (
        <ol className="comment-list">
          {comments.map((comment) => (
            <li key={comment.id} className={comment.isInternal ? "is-internal" : undefined}>
              {comment.isInternal ? <p className="comment-badge">Nota interna (só atendentes)</p> : null}
              <p className="comment-body">{comment.body}</p>
              <p className="metadata">
                {comment.author.name} ({roleLabels[comment.author.role]}) ·{" "}
                <time dateTime={comment.createdAt.toISOString()}>
                  {comment.createdAt.toLocaleString("pt-BR")}
                </time>
              </p>
            </li>
          ))}
        </ol>
      )}
      {canWrite ? (
        <form action={action} className="comment-form">
          <input type="hidden" name="requestId" value={requestId} />
          <label htmlFor="comment-body">Novo comentário</label>
          <textarea id="comment-body" name="body" required maxLength={MAX_COMMENT_LENGTH} rows={3} />
          {allowInternal ? (
            <label className="checkbox-label">
              <input type="checkbox" name="isInternal" />
              Nota interna (o solicitante não vê)
            </label>
          ) : null}
          <button type="submit">Enviar comentário</button>
        </form>
      ) : (
        <p className="metadata">Esta solicitação foi cancelada; a conversa está encerrada.</p>
      )}
    </section>
  );
}
