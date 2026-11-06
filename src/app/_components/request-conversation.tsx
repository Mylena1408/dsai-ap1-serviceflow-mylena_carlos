import { MAX_COMMENT_LENGTH, type CommentRecord } from "@/modules/comments";
import { COMMENT_FILES_FIELD } from "./comment-form-data";
import { CannedResponsePicker, type PickerResponse } from "./canned-response-picker";

type RequestConversationProps = {
  requestId: string;
  comments: CommentRecord[];
  /** Cancelled requests keep the conversation read-only (decision C1). */
  canWrite: boolean;
  /** Attendants may mark a comment as an internal note (decision C3). */
  allowInternal: boolean;
  action: (formData: FormData) => Promise<never>;
  /** Canned responses of the attendant's sector, already rendered (SPEC 2026-11-06-respostas-prontas). */
  cannedResponses?: readonly PickerResponse[];
};

function fileSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
  cannedResponses = [],
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
              {comment.files && comment.files.length > 0 ? (
                // SPEC 2026-11-03-anexos-comentarios-documentos, 5.2: same visibility as the comment.
                <ul className="comment-files" aria-label="Arquivos do comentário">
                  {comment.files.map((file) => (
                    <li key={file.id}>
                      {file.removed ? (
                        <span>Arquivo removido na anonimização</span>
                      ) : (
                        <a href={`/api/requests/${requestId}/comments/${comment.id}/files/${file.id}`}>
                          {file.originalFilename}
                        </a>
                      )}{" "}
                      <span className="metadata">
                        ({file.detectedFormat}, {fileSize(file.sizeBytes)})
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
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
          <CannedResponsePicker responses={cannedResponses} targetId="comment-body" />
          <label htmlFor="comment-body">Novo comentário</label>
          <textarea id="comment-body" name="body" required maxLength={MAX_COMMENT_LENGTH} rows={3} />
          <label htmlFor="comment-files">Arquivos (opcional)</label>
          <input id="comment-files" name={COMMENT_FILES_FIELD} type="file" multiple accept=".pdf,.docx,.txt" />
          <p className="metadata">Até 3 arquivos PDF, DOCX ou TXT, de até 2 MiB cada e 4 MiB somados.</p>
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
