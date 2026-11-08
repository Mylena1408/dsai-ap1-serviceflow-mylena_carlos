import { MAX_CHECKLIST_NOTE_LENGTH, checklistProgressLabel, type RequestChecklistItemView, type RequestChecklistView } from "@/modules/checklists";

// A request's checklist on the team's screens (SPEC 2026-11-08-atendimento-dia-a-dia, 4.3 and 13.1; decision I6):
// the items with who marked them and the note, the progress and the required items still to mark. The attendant
// who may act marks with an optional note and unmarks; the manager only reads. Without a checklist, nothing is
// shown (CA-CHK-01).

/** 4.3 item 4 (decision I8): the refused completion lists what is missing, as read now. */
export function checklistPendingText(pending: ReadonlyArray<Pick<RequestChecklistItemView, "textSnapshot">>): string | null {
  return pending.length === 0 ? null : `Falta marcar: ${pending.map(({ textSnapshot }) => `"${textSnapshot}"`).join(", ")}.`;
}

/** The page's messages for the checklist's results. */
export function checklistFeedback(code: string | undefined): string | null {
  if (code === "checklist-done") return "Item do checklist marcado.";
  if (code === "checklist-undone") return "Item do checklist desmarcado.";
  if (code === "checklist-note") return `Escreva a observação com até ${MAX_CHECKLIST_NOTE_LENGTH} caracteres.`;
  if (code === "checklist-state") return "Não é possível mudar o checklist agora: a solicitação não está em atendimento, você não é o responsável, ou o item mudou enquanto você agia.";
  return null;
}

function doneLine(item: RequestChecklistItemView): string | null {
  if (!item.doneAt) return null;
  return `Concluído por ${item.doneByName ?? "—"} em ${item.doneAt.toLocaleString("pt-BR")}`;
}

export function RequestChecklist({
  requestId,
  view,
  markAction,
}: {
  requestId: string;
  view: RequestChecklistView;
  /** The attendant's action; without it, or when the reader may not mark now, the block only shows the items. */
  markAction?: (formData: FormData) => Promise<never>;
}) {
  if (!view.items || view.items.length === 0 || !view.progress) return null;
  const editable = Boolean(markAction) && view.canMark;

  return (
    <section aria-labelledby="checklist-heading" className="surface-card content-section" id="checklist">
      <p className="eyebrow">Atendimento</p>
      <h2 id="checklist-heading">Checklist</h2>
      <p className="section-description">
        {checklistProgressLabel(view.progress)} · Só a equipe vê este checklist.
      </p>
      {view.pending.length > 0 ? (
        <p className="feedback feedback-error" role="note">
          Obrigatórios por marcar: {view.pending.map(({ textSnapshot }) => textSnapshot).join(", ")}. A solicitação só é concluída com eles marcados.
        </p>
      ) : (
        <p className="section-description">Todos os itens obrigatórios estão marcados.</p>
      )}
      <ol className="checklist-items">
        {view.items.map((item) => (
          <li key={item.id}>
            <p>
              <strong>{item.doneAt ? "✔ " : "○ "}</strong>
              {item.textSnapshot} <span className="section-description">({item.isRequired ? "obrigatório" : "opcional"})</span>
            </p>
            {doneLine(item) ? <p className="section-description">{doneLine(item)}</p> : null}
            {item.note ? <p className="history-note">Observação: {item.note}</p> : null}
            {editable && markAction ? (
              item.doneAt ? (
                <form action={markAction}>
                  <input name="requestId" type="hidden" value={requestId} />
                  <input name="itemId" type="hidden" value={item.id} />
                  <input name="done" type="hidden" value="false" />
                  <button aria-label={`Desmarcar ${item.textSnapshot}`} className="button-secondary" type="submit">
                    Desmarcar
                  </button>
                </form>
              ) : (
                <form action={markAction} aria-label={`Marcar ${item.textSnapshot}`} className="inline-form">
                  <input name="requestId" type="hidden" value={requestId} />
                  <input name="itemId" type="hidden" value={item.id} />
                  <input name="done" type="hidden" value="true" />
                  <label>
                    Observação (opcional)
                    <input maxLength={MAX_CHECKLIST_NOTE_LENGTH} name="note" />
                  </label>
                  <button type="submit">Marcar como concluído</button>
                </form>
              )
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
