import { MAX_TAGS_PER_REQUEST, type RequestTagEventView, type RequestTagsView } from "@/modules/tags";
import { TagChip } from "./sector-tags";

// The tags of a request (SPEC 2026-11-08-atendimento-dia-a-dia, 3.3 item 2; decision I2): only the team sees
// them. The sector's attendants put tags on and take them off; the manager reads them. A tag of a former sector
// is shown in gray until someone takes it off (decision I4).

export function tagEventTitle(event: Pick<RequestTagEventView, "action" | "tagName">): string {
  return event.action === "ADDED" ? `Etiqueta "${event.tagName}" aplicada` : `Etiqueta "${event.tagName}" retirada`;
}

export function RequestTags({
  requestId,
  view,
  edit,
}: {
  requestId: string;
  view: RequestTagsView;
  /** The attendant's actions; without them the block only shows the tags. */
  edit?: { addAction: (formData: FormData) => Promise<never>; removeAction: (formData: FormData) => Promise<never> };
}) {
  const editable = Boolean(edit) && view.canEdit;
  if (view.tags.length === 0 && !editable) return null;

  return (
    <section className="surface-card content-section" aria-labelledby="request-tags-heading">
      <h2 id="request-tags-heading">Etiquetas</h2>
      <p className="section-description">Só a equipe vê as etiquetas.</p>
      {view.tags.length === 0 ? (
        <p>Nenhuma etiqueta.</p>
      ) : (
        <ul aria-label="Etiquetas da solicitação" className="plain-list tag-list">
          {view.tags.map((tag) => (
            <li key={tag.id}>
              <TagChip color={tag.color} muted={tag.fromOtherSector || !tag.isActive} name={tag.name} />
              {tag.fromOtherSector ? <span className="metadata"> (de outro setor)</span> : null}
              {editable && edit ? (
                <form action={edit.removeAction} className="inline-form">
                  <input name="requestId" type="hidden" value={requestId} />
                  <input name="tagId" type="hidden" value={tag.id} />
                  <button aria-label={`Retirar a etiqueta ${tag.name}`} className="button-secondary" type="submit">
                    Retirar
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {editable && edit ? (
        view.tags.length >= MAX_TAGS_PER_REQUEST ? (
          <p className="section-description">A solicitação já tem {MAX_TAGS_PER_REQUEST} etiquetas; retire uma para aplicar outra.</p>
        ) : view.choices.length === 0 ? (
          <p className="section-description">O setor não tem outras etiquetas ativas.</p>
        ) : (
          <form action={edit.addAction} aria-label="Aplicar etiqueta" className="inline-form">
            <input name="requestId" type="hidden" value={requestId} />
            <label>
              Etiqueta
              <select name="tagId" required>
                {view.choices.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">Aplicar</button>
          </form>
        )
      ) : null}
    </section>
  );
}
