import {
  ANNOUNCEMENT_AUDIENCE_LABELS,
  ANNOUNCEMENT_KIND_LABELS,
  ANNOUNCEMENT_LEVEL_LABELS,
  ANNOUNCEMENT_ROLES,
  DEFAULT_LEAD_HOURS,
  MAX_ANNOUNCEMENT_BODY_LENGTH,
  MAX_ANNOUNCEMENT_TITLE_LENGTH,
  MAX_LEAD_HOURS,
  formatAnnouncementInstant,
  stripStartsAt,
  toLocalDateTimeInput,
  type AnnouncementAdminItem,
  type AnnouncementAdminOverview,
  type AnnouncementStatus,
} from "@/modules/announcements";
import { ROLE_LABELS } from "@/shared/admin-labels";
import { closeAnnouncementAction, createAnnouncementAction, deleteAnnouncementAction, updateAnnouncementAction } from "./actions";
import { announcementMessage } from "./messages";

// The section "Avisos" of the administration (SPEC 2026-11-09-comunicacao-e-calendarios, 3.1 item 1 and 3.3; SF-235):
// the announcements going on, scheduled and ended in the last 90 days; create, change, close and delete. Without
// JavaScript, every field is on the form; the rules use only the ones of the chosen kind and audience.

const STATUS_LABELS: Record<AnnouncementStatus, string> = { current: "Em andamento", scheduled: "Programado", ended: "Encerrado" };

export function audienceText(item: Pick<AnnouncementAdminItem, "audience" | "audienceRole" | "audienceSectorName">): string {
  if (item.audience === "ROLE" && item.audienceRole) return `Perfil: ${ROLE_LABELS[item.audienceRole]}`;
  if (item.audience === "SECTOR") return `Setor: ${item.audienceSectorName ?? "(removido)"}`;
  return "Todos";
}

export function periodText(item: Pick<AnnouncementAdminItem, "kind" | "startsAt" | "endsAt" | "leadHours">): string {
  const period = `${formatAnnouncementInstant(item.startsAt)} a ${formatAnnouncementInstant(item.endsAt)}`;
  if (item.kind !== "MAINTENANCE") return period;
  return `${period} (na faixa desde ${formatAnnouncementInstant(stripStartsAt(item))})`;
}

function AnnouncementFields({ item, sectors, idPrefix }: { item?: AnnouncementAdminItem; sectors: AnnouncementAdminOverview["sectors"]; idPrefix: string }) {
  return (
    <>
      <label htmlFor={`${idPrefix}-title`}>Título</label>
      <input defaultValue={item?.title} id={`${idPrefix}-title`} maxLength={MAX_ANNOUNCEMENT_TITLE_LENGTH} name="title" required />
      <label htmlFor={`${idPrefix}-body`}>Texto</label>
      <textarea defaultValue={item?.body} id={`${idPrefix}-body`} maxLength={MAX_ANNOUNCEMENT_BODY_LENGTH} name="body" required rows={3} />
      <label>
        Tipo
        <select defaultValue={item?.kind ?? "NOTICE"} name="kind">
          <option value="NOTICE">{ANNOUNCEMENT_KIND_LABELS.NOTICE}</option>
          <option value="MAINTENANCE">{ANNOUNCEMENT_KIND_LABELS.MAINTENANCE}</option>
        </select>
      </label>
      <label>
        Nível (só para aviso; a manutenção é sempre de atenção)
        <select defaultValue={item?.level ?? "INFO"} name="level">
          <option value="INFO">{ANNOUNCEMENT_LEVEL_LABELS.INFO}</option>
          <option value="WARNING">{ANNOUNCEMENT_LEVEL_LABELS.WARNING}</option>
        </select>
      </label>
      <label>
        Público
        <select defaultValue={item?.audience ?? "ALL"} name="audience">
          <option value="ALL">{ANNOUNCEMENT_AUDIENCE_LABELS.ALL}</option>
          <option value="ROLE">{ANNOUNCEMENT_AUDIENCE_LABELS.ROLE}</option>
          <option value="SECTOR">{ANNOUNCEMENT_AUDIENCE_LABELS.SECTOR}</option>
        </select>
      </label>
      <label>
        Perfil (para o público &quot;um perfil&quot;)
        <select defaultValue={item?.audienceRole ?? ""} name="audienceRole">
          <option value="">—</option>
          {ANNOUNCEMENT_ROLES.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Setor (para o público &quot;um setor&quot;)
        <select defaultValue={item?.audienceSectorId ?? ""} name="audienceSectorId">
          <option value="">—</option>
          {sectors.map((sector) => (
            <option key={sector.id} value={sector.id}>
              {sector.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Início (para a manutenção, o início da janela)
        <input defaultValue={item ? toLocalDateTimeInput(item.startsAt) : undefined} name="startsAt" required type="datetime-local" />
      </label>
      <label>
        Fim
        <input defaultValue={item ? toLocalDateTimeInput(item.endsAt) : undefined} name="endsAt" required type="datetime-local" />
      </label>
      <label>
        Antecedência em horas (só para manutenção)
        <input defaultValue={item?.leadHours ?? DEFAULT_LEAD_HOURS} max={MAX_LEAD_HOURS} min={0} name="leadHours" step={1} type="number" />
      </label>
    </>
  );
}

export function AnnouncementsSection({ overview, message }: { overview: AnnouncementAdminOverview; message?: string }) {
  const feedback = announcementMessage(message);

  return (
    <section aria-labelledby="announcements-heading" className="admin-section surface-card content-section">
      <h2 id="announcements-heading">Avisos</h2>
      <p className="section-description">
        Avisos aparecem numa faixa no topo das telas do público escolhido, durante o período. A manutenção aparece com antecedência e
        durante a janela, só como aviso: nada é bloqueado. Datas e horas no fuso da organização.
      </p>
      {feedback ? (
        <p className={`feedback${feedback.error ? " feedback-error" : ""}`} role={feedback.error ? "alert" : "status"}>
          {feedback.text}
        </p>
      ) : null}

      <details>
        <summary>Novo aviso</summary>
        <form action={createAnnouncementAction} aria-label="Novo aviso" className="stacked-form">
          <AnnouncementFields idPrefix="new-announcement" sectors={overview.sectors} />
          <button type="submit">Criar aviso</button>
        </form>
      </details>

      {overview.announcements.length === 0 ? (
        <p className="section-description">Nenhum aviso em andamento, programado ou encerrado nos últimos 90 dias.</p>
      ) : (
        <table className="data-table">
          <caption>Avisos</caption>
          <thead>
            <tr>
              <th scope="col">Aviso</th>
              <th scope="col">Tipo</th>
              <th scope="col">Público</th>
              <th scope="col">Período</th>
              <th scope="col">Situação</th>
              <th scope="col">Ações</th>
            </tr>
          </thead>
          <tbody>
            {overview.announcements.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.title}</strong>
                  <br />
                  <span className="metadata">Criado por {item.createdByName}</span>
                </td>
                <td>{item.kind === "MAINTENANCE" ? ANNOUNCEMENT_KIND_LABELS.MAINTENANCE : `${ANNOUNCEMENT_KIND_LABELS.NOTICE} · ${ANNOUNCEMENT_LEVEL_LABELS[item.level]}`}</td>
                <td>{audienceText(item)}</td>
                <td>{periodText(item)}</td>
                <td>{STATUS_LABELS[item.status]}</td>
                <td>
                  {item.status !== "ended" ? (
                    <details>
                      <summary>Alterar</summary>
                      <form action={updateAnnouncementAction} aria-label={`Alterar o aviso ${item.title}`} className="stacked-form">
                        <input name="announcementId" type="hidden" value={item.id} />
                        <AnnouncementFields idPrefix={`announcement-${item.id}`} item={item} sectors={overview.sectors} />
                        <button type="submit">Salvar</button>
                      </form>
                    </details>
                  ) : null}
                  {item.status === "current" ? (
                    <form action={closeAnnouncementAction}>
                      <input name="announcementId" type="hidden" value={item.id} />
                      <button aria-label={`Encerrar o aviso ${item.title}`} className="button-secondary" type="submit">
                        Encerrar
                      </button>
                    </form>
                  ) : null}
                  {item.status === "scheduled" ? (
                    <form action={deleteAnnouncementAction}>
                      <input name="announcementId" type="hidden" value={item.id} />
                      <button aria-label={`Apagar o aviso ${item.title}`} className="button-secondary" type="submit">
                        Apagar
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
