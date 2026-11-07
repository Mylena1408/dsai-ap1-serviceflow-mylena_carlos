import Link from "next/link";
import { MAX_SEARCH_TERM, type RequestStatus } from "@/modules/requests";
import { REQUEST_STATUS_LABELS } from "./request-status";
import type { SearchParams } from "./request-search-url";

type RequestSearchFormProps = {
  basePath: string;
  params: SearchParams;
  /** The assignee filter exists only in the attendant queue (section 5.3). */
  showAssignee: boolean;
  /** The SLA filter and the "due" order exist only in the queue (SPEC 2026-11-01, 5.6). */
  showSla?: boolean;
  /**
   * The queue's "Etapa" filter (SPEC 2026-11-06-aprofundamento-configurabilidade, 5.3.4): the current
   * stages of the sector's requests in progress. Absent in the requester list.
   */
  stageChoices?: string[];
  defaultOrder: "newest" | "oldest";
};

/** The value of "Sem etapa" (the same as the request module's NO_STAGE_FILTER). */
const NO_STAGE = "__none__";

const STATUSES: RequestStatus[] = ["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"];

function values(value: string | string[] | undefined): string[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

function first(value: string | string[] | undefined): string {
  return values(value)[0] ?? "";
}

// GET form: works without JavaScript, keeps the criteria in the URL and always starts on
// page 1 because it carries no page field (SPEC 2026-10-31-busca-filtros-paginacao, 5.5).
export function RequestSearchForm({ basePath, params, showAssignee, showSla = false, stageChoices, defaultOrder }: RequestSearchFormProps) {
  const currentStage = first(params.stage);
  // A stage chosen before it left the list stays selectable, so the form shows what the URL filters.
  const stageOptions = stageChoices && currentStage && currentStage !== NO_STAGE && !stageChoices.includes(currentStage)
    ? [...stageChoices, currentStage]
    : stageChoices;
  const statuses = values(params.status);

  return (
    <form method="get" action={basePath} className="surface-card search-form" role="search">
      <div className="search-field">
        <label htmlFor="search-term">Buscar</label>
        <input
          id="search-term"
          name="q"
          type="search"
          defaultValue={first(params.q)}
          maxLength={MAX_SEARCH_TERM}
          // SPEC 2026-11-06-aprofundamento-configurabilidade, 3.3.5: the answers are searched too.
          placeholder="Descrição, serviço ou respostas"
        />
      </div>
      <fieldset className="search-statuses">
        <legend>Status</legend>
        {STATUSES.map((status) => (
          <label key={status} className="checkbox-label">
            <input type="checkbox" name="status" value={status} defaultChecked={statuses.includes(status)} />
            {REQUEST_STATUS_LABELS[status]}
          </label>
        ))}
      </fieldset>
      {showAssignee ? (
        <div className="search-field">
          <label htmlFor="search-assignee">Responsável</label>
          <select id="search-assignee" name="assignee" defaultValue={first(params.assignee) || "all"}>
            <option value="all">Todos</option>
            <option value="mine">Atribuídas a mim</option>
            <option value="unassigned">Sem responsável</option>
          </select>
        </div>
      ) : null}
      {showSla ? (
        <div className="search-field">
          <label htmlFor="search-sla">Situação do prazo</label>
          <select id="search-sla" name="sla" defaultValue={first(params.sla)}>
            <option value="">Todas</option>
            <option value="on_time">Dentro do prazo</option>
            <option value="due_soon">Próximo do vencimento</option>
            <option value="overdue">Vencido</option>
            <option value="none">Sem prazo</option>
            <option value="paused">Pausado</option>
          </select>
        </div>
      ) : null}
      {stageOptions ? (
        <div className="search-field">
          <label htmlFor="search-stage">Etapa</label>
          <select id="search-stage" name="stage" defaultValue={currentStage}>
            <option value="">Todas</option>
            <option value={NO_STAGE}>Sem etapa</option>
            {stageOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="search-field">
        <label htmlFor="search-from">Aberta de</label>
        <input id="search-from" name="from" type="date" defaultValue={first(params.from)} />
      </div>
      <div className="search-field">
        <label htmlFor="search-to">até</label>
        <input id="search-to" name="to" type="date" defaultValue={first(params.to)} />
      </div>
      <div className="search-field">
        <label htmlFor="search-order">Ordem</label>
        <select id="search-order" name="order" defaultValue={first(params.order) || defaultOrder}>
          <option value="newest">Mais recentes primeiro</option>
          <option value="oldest">Mais antigas primeiro</option>
          {showSla ? <option value="due">Vencimento mais próximo</option> : null}
        </select>
      </div>
      <div className="search-actions">
        <button type="submit">Buscar</button>
        <Link href={basePath}>Limpar</Link>
      </div>
    </form>
  );
}
