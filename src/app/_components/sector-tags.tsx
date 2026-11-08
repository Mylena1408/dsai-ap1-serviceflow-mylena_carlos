import { MAX_ACTIVE_TAGS_PER_SECTOR, MAX_TAG_NAME_LENGTH, TAG_COLORS, TAG_COLOR_KEYS, type SectorTags, type TagColor } from "@/modules/tags";
import { createSectorTagAction, setSectorTagActiveAction, updateSectorTagAction } from "./sector-tag-actions";

// The sectors' tags (SPEC 2026-11-08-atendimento-dia-a-dia, 3.3 item 1), shared by the administration (every
// sector) and the manager's area (their sector): create, rename, recolor, deactivate and reactivate.

const MESSAGES: Record<string, { text: string; error: boolean }> = {
  "tag-created": { text: "Etiqueta criada.", error: false },
  "tag-updated": { text: "Etiqueta alterada.", error: false },
  "tag-deactivated": { text: "Etiqueta desativada. Ela continua nas solicitações que já a têm.", error: false },
  "tag-reactivated": { text: "Etiqueta reativada.", error: false },
  "tag-taken": { text: "O setor já tem uma etiqueta ativa com esse nome.", error: true },
  "tag-limit": { text: `O setor já tem ${MAX_ACTIVE_TAGS_PER_SECTOR} etiquetas ativas. Desative alguma antes.`, error: true },
  "tag-invalid": { text: `Dê um nome de 1 a ${MAX_TAG_NAME_LENGTH} caracteres e escolha uma cor da lista.`, error: true },
  "tag-missing": { text: "A etiqueta ou o setor não está disponível para você.", error: true },
};

export function sectorTagMessage(code: string | undefined): { text: string; error: boolean } | null {
  return code ? (MESSAGES[code] ?? null) : null;
}

/** A tag as the screens show it, in its palette color. */
export function TagChip({ name, color, muted = false }: { name: string; color: TagColor; muted?: boolean }) {
  const palette = TAG_COLORS[color];
  return (
    <span
      className="tag-chip"
      style={{
        backgroundColor: muted ? TAG_COLORS.gray.background : palette.background,
        color: muted ? TAG_COLORS.gray.text : palette.text,
        borderRadius: "999px",
        padding: "0.1rem 0.6rem",
        fontSize: "0.85rem",
        display: "inline-block",
      }}
    >
      {name}
    </span>
  );
}

function ColorSelect({ defaultValue }: { defaultValue?: TagColor }) {
  return (
    <select defaultValue={defaultValue ?? "blue"} name="color">
      {TAG_COLOR_KEYS.map((color) => (
        <option key={color} value={color}>
          {TAG_COLORS[color].label}
        </option>
      ))}
    </select>
  );
}

export function SectorTagsPanel({ sectors, area, message }: { sectors: SectorTags[]; area: "approvals" | "admin"; message?: string }) {
  const feedback = sectorTagMessage(message);

  return (
    <section className="surface-card content-section" aria-labelledby="sector-tags-heading">
      <h2 id="sector-tags-heading">Etiquetas dos setores</h2>
      <p className="section-description">
        As etiquetas organizam a fila do setor. Só a equipe vê; o solicitante não. Desativar uma etiqueta não a retira das solicitações.
      </p>
      {feedback ? (
        <p className={`feedback${feedback.error ? " feedback-error" : ""}`} role={feedback.error ? "alert" : "status"}>
          {feedback.text}
        </p>
      ) : null}
      {sectors.length === 0 ? <p>Nenhum setor ativo.</p> : null}
      {sectors.map(({ sector, tags }) => (
        <section aria-label={`Etiquetas de ${sector.name}`} className="sector-tags" key={sector.id}>
          <h3>{sector.name}</h3>
          <form action={createSectorTagAction} aria-label={`Nova etiqueta de ${sector.name}`} className="inline-form">
            <input name="area" type="hidden" value={area} />
            <input name="sectorId" type="hidden" value={sector.id} />
            <label>
              Nome
              <input maxLength={MAX_TAG_NAME_LENGTH} name="name" required />
            </label>
            <label>
              Cor
              <ColorSelect />
            </label>
            <button type="submit">Criar etiqueta</button>
          </form>
          {tags.length === 0 ? (
            <p className="section-description">Nenhuma etiqueta.</p>
          ) : (
            <table className="data-table">
              <caption>Etiquetas de {sector.name}</caption>
              <thead>
                <tr>
                  <th scope="col">Etiqueta</th>
                  <th scope="col">Situação</th>
                  <th scope="col">Em uso</th>
                  <th scope="col">Ações</th>
                </tr>
              </thead>
              <tbody>
                {tags.map((tag) => (
                  <tr key={tag.id}>
                    <td>
                      <TagChip color={tag.color} muted={!tag.isActive} name={tag.name} />
                    </td>
                    <td>{tag.isActive ? "Ativa" : "Inativa"}</td>
                    <td>{tag.inUse === 1 ? "1 solicitação" : `${tag.inUse} solicitações`}</td>
                    <td>
                      <details>
                        <summary>Alterar</summary>
                        <form action={updateSectorTagAction} aria-label={`Alterar a etiqueta ${tag.name}`} className="inline-form">
                          <input name="area" type="hidden" value={area} />
                          <input name="tagId" type="hidden" value={tag.id} />
                          <label>
                            Nome
                            <input defaultValue={tag.name} maxLength={MAX_TAG_NAME_LENGTH} name="name" required />
                          </label>
                          <label>
                            Cor
                            <ColorSelect defaultValue={tag.color} />
                          </label>
                          <button type="submit">Salvar</button>
                        </form>
                      </details>
                      <form action={setSectorTagActiveAction}>
                        <input name="area" type="hidden" value={area} />
                        <input name="tagId" type="hidden" value={tag.id} />
                        <input name="isActive" type="hidden" value={tag.isActive ? "false" : "true"} />
                        <button className="button-secondary" type="submit">
                          {tag.isActive ? "Desativar" : "Reativar"}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </section>
  );
}
