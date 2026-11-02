import { barPercentage, type Dashboard, type ReportGroup, type ReportPeriodError } from "@/modules/reports";

// Dashboard screens (SPEC 2026-11-02-painel-relatorios, 5.1 to 5.5): filters in the URL (GET form),
// the current situation, the period indicators and bars in HTML and CSS with their numbers.
// No link leads to a request: the read rules of each request do not change (5.7).

/** Also used by the audit section, which has the same period filter. */
export const PERIOD_ERRORS: Record<ReportPeriodError, string> = {
  invalid_option: "Escolha um dos períodos da lista.",
  missing_dates: "Informe a data de início e a de fim do intervalo.",
  invalid_date: "Informe datas válidas.",
  inverted_range: "A data de início precisa ser anterior ou igual à de fim.",
  future_date: "A data de fim não pode ser posterior a hoje.",
  too_long: "O intervalo pode ter no máximo 366 dias.",
};

const numbers = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

function day(value: string): string {
  const [year, month, date] = value.split("-");
  return `${date}/${month}/${year}`;
}

function hours(value: number): string {
  return `${numbers.format(value)} h`;
}

/** Messages of refused filters; the screen then shows the default period or every sector. */
export function dashboardFilterMessages(errors: Dashboard["errors"]): string[] {
  return [
    ...(errors.period ? [`${PERIOD_ERRORS[errors.period]} Mostrando os últimos 30 dias.`] : []),
    ...(errors.sector ? ["Setor não encontrado. Mostrando toda a organização."] : []),
  ];
}

function Indicator({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="dashboard-indicator">
      <dt>{label}</dt>
      <dd>
        <strong>{value}</strong>
        {detail ? <span>{detail}</span> : null}
      </dd>
    </div>
  );
}

function GroupTable({ title, groups }: { title: string; groups: ReportGroup[] }) {
  const largest = groups[0]?.count ?? 0;

  return (
    <section className="dashboard-group" aria-label={title}>
      <h3>{title}</h3>
      {groups.length === 0 ? (
        <p className="metadata">Nenhuma solicitação aberta no período.</p>
      ) : (
        <table className="dashboard-bars">
          <thead>
            <tr>
              <th scope="col">Nome</th>
              <th scope="col">Solicitações</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.label}>
                <th scope="row">{group.label}</th>
                <td>
                  <span className="dashboard-bar" aria-hidden="true">
                    <span style={{ width: `${barPercentage(group.count, largest)}%` }} />
                  </span>
                  <span className="dashboard-bar-value">{group.count}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/**
 * Parameters of the CSV export for what the screen shows (SPEC 5.4): the period in use (the
 * default one when the requested period was refused) and the administrator's sector.
 */
export function dashboardExportParams(dashboard: Dashboard): Record<string, string> {
  const { period } = dashboard;
  return {
    period: period.option,
    ...(period.option === "custom" ? { from: period.firstDay, to: period.lastDay } : {}),
    ...(dashboard.audience === "organization" && dashboard.sector ? { sector: dashboard.sector.id } : {}),
  };
}

function ExportForm({ dashboard }: { dashboard: Dashboard }) {
  return (
    <form method="get" action="/api/reports/requests.csv" className="dashboard-export">
      {Object.entries(dashboardExportParams(dashboard)).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button className="button-secondary" type="submit">
        Exportar CSV
      </button>
      <span className="metadata">Solicitações abertas no período, até 10.000 linhas, sem dados do solicitante.</span>
    </form>
  );
}

type DashboardViewProps = {
  dashboard: Dashboard;
  /** Path of the GET form, e.g. "/admin" or "/approvals/dashboard". */
  action: string;
  /** Fixed parameters kept by the form, e.g. the administration section. */
  hidden?: Record<string, string>;
};

export function DashboardView({ dashboard, action, hidden = {} }: DashboardViewProps) {
  const { period, current, totals } = dashboard;
  const messages = dashboardFilterMessages(dashboard.errors);
  const custom = period.option === "custom";
  const scopeName =
    dashboard.sector?.name ?? (dashboard.audience === "organization" ? "Toda a organização" : "Seu setor");

  return (
    <div className="dashboard">
      <form method="get" action={action} className="surface-card dashboard-filters" aria-label="Filtros do painel">
        {Object.entries(hidden).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        {dashboard.audience === "organization" ? (
          <div className="search-field">
            <label htmlFor="dashboard-sector">Setor</label>
            <select id="dashboard-sector" name="sector" defaultValue={dashboard.sector?.id ?? ""}>
              <option value="">Toda a organização</option>
              {dashboard.sectors.map((sector) => (
                <option key={sector.id} value={sector.id}>
                  {sector.isActive ? sector.name : `${sector.name} (inativo)`}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="search-field">
          <label htmlFor="dashboard-period">Período</label>
          <select id="dashboard-period" name="period" defaultValue={period.option}>
            <option value="7">Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option>
            <option value="90">Últimos 90 dias</option>
            <option value="custom">Intervalo de datas</option>
          </select>
        </div>
        <div className="search-field">
          <label htmlFor="dashboard-from">De</label>
          <input id="dashboard-from" name="from" type="date" defaultValue={custom ? period.firstDay : ""} />
        </div>
        <div className="search-field">
          <label htmlFor="dashboard-to">Até</label>
          <input id="dashboard-to" name="to" type="date" defaultValue={custom ? period.lastDay : ""} />
        </div>
        <button type="submit">Aplicar</button>
        <p className="metadata wide-field">As datas valem só para &quot;Intervalo de datas&quot;. Dias contados no horário de Brasília.</p>
      </form>

      {messages.map((message) => (
        <p className="feedback feedback-error" role="alert" key={message}>
          {message}
        </p>
      ))}

      {dashboard.withoutSector ? (
        <p className="empty-state">Você não está ligado a um setor ativo, então não há números para mostrar.</p>
      ) : null}

      <section className="surface-card" aria-labelledby="dashboard-current">
        <h2 id="dashboard-current">Situação atual</h2>
        <p className="metadata">{scopeName} · todas as solicitações, independentemente do período.</p>
        <dl className="dashboard-indicators">
          <Indicator label="Abertas" value={String(current.open)} />
          <Indicator label="Aguardando aprovação" value={String(current.awaitingApproval)} />
          <Indicator label="Em atendimento" value={String(current.inProgress)} />
          <Indicator label="Próximas do vencimento" value={String(current.dueSoon)} />
          <Indicator label="Vencidas" value={String(current.overdue)} />
        </dl>
      </section>

      <section className="surface-card" aria-labelledby="dashboard-period-heading">
        <h2 id="dashboard-period-heading">No período</h2>
        <p className="metadata">
          {scopeName} · de {day(period.firstDay)} a {day(period.lastDay)}.
        </p>
        {dashboard.withoutSector ? null : <ExportForm dashboard={dashboard} />}
        {dashboard.empty ? <p className="empty-state">Nenhuma solicitação no período.</p> : null}
        <dl className="dashboard-indicators">
          <Indicator label="Abertas no período" value={String(totals.opened)} />
          <Indicator label="Concluídas no período" value={String(totals.completed)} />
          <Indicator label="Canceladas no período" value={String(totals.cancelled)} />
          <Indicator
            label="Tempo até a conclusão"
            value={totals.completion ? hours(totals.completion.averageHours) : "—"}
            detail={totals.completion ? `média · mediana ${hours(totals.completion.medianHours)}` : undefined}
          />
          <Indicator
            label="Concluídas no prazo"
            value={totals.onTimePercentage === null ? "—" : `${totals.onTimePercentage}%`}
            detail={totals.onTimePercentage === null ? "sem prazo definido" : undefined}
          />
        </dl>
        <div className="dashboard-groups">
          <GroupTable title="Por categoria" groups={totals.byCategory} />
          {totals.bySector ? <GroupTable title="Por setor" groups={totals.bySector} /> : null}
          <GroupTable title="Por status atual" groups={totals.byStatus} />
        </div>
      </section>
    </div>
  );
}
