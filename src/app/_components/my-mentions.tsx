import Link from "next/link";
import { countUnseenMentions, type MyMention } from "@/modules/comments";

// "Minhas menções" (SPEC 2026-11-08-atendimento-dia-a-dia, 13.4 item 1; decision J8): the list and the menu's link.

/** The menu's link with the count of mentions not seen; never breaks the page if counting fails. */
export async function MyMentionsLink() {
  let unseen = 0;
  try {
    unseen = await countUnseenMentions();
  } catch {
    // The page itself enforces access; the link just shows no count.
  }
  return (
    <Link aria-label={unseen > 0 ? `Minhas menções, ${unseen} não vistas` : "Minhas menções"} href="/queue/mentions">
      Minhas menções{unseen > 0 ? <span className="notification-badge"> {unseen}</span> : null}
    </Link>
  );
}

export function MyMentionsList({
  mentions,
  openAction,
  error,
}: {
  mentions: readonly MyMention[];
  openAction: (formData: FormData) => Promise<never>;
  error?: string;
}) {
  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Atendimento</p>
          <h1>Minhas menções</h1>
          <p>Notas internas em que colegas do setor mencionaram você. Abrir uma menção a marca como vista.</p>
        </div>
      </header>
      {error === "missing" ? (
        <p className="feedback feedback-error" role="alert">
          A menção não está mais disponível para você.
        </p>
      ) : null}
      {mentions.length === 0 ? (
        <p className="empty-state">Nenhuma menção.</p>
      ) : (
        <ul aria-label="Menções recebidas" className="content-list">
          {mentions.map((mention) => (
            <li className="surface-card" key={mention.commentId}>
              <p>
                <strong>{mention.serviceName}</strong> {mention.seenAt === null ? <span className="status-pill">Nova</span> : null}
              </p>
              <p className="metadata">
                {mention.authorName} mencionou você ·{" "}
                <time dateTime={mention.createdAt.toISOString()}>{mention.createdAt.toLocaleString("pt-BR")}</time>
                {mention.seenAt ? " · vista" : ""}
              </p>
              <form action={openAction}>
                <input name="commentId" type="hidden" value={mention.commentId} />
                <button aria-label={`Abrir a menção em ${mention.serviceName}`} type="submit">
                  Abrir
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <p>
        <Link href="/queue">Voltar à fila</Link>
      </p>
    </main>
  );
}
