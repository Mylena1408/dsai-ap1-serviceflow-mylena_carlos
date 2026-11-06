import type { Analytics, AttendantDashboard, ReportPeriod, ReportSector, WorkSummary } from "@/modules/reports";
import { ArrivalHeatmap, ColumnPairChart, LineChart, PercentBars } from "./charts";
import { GroupTable, Indicator, PERIOD_ERRORS } from "./dashboard-view";

// Screens of the operational analytics (SPEC 2026-11-06-analises-operacionais): "Meu painel" of
// the attendant and "Análises" of the administrator and the manager. Filters in the URL (GET
// form), as in the dashboard. Nothing links to a request: the read rules do not change (5.1).

export const TEAM_NOTICE =
  "Use estes números para distribuir o trabalho. Eles não medem a complexidade de cada solicitação e não devem ser o único critério para avaliar uma pessoa.";

const numbers = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

function hours(value: number): string {
  return `${numbers.format(value)} h`;
}

function day(value: string): string {
  const [year, month, date] = value.split("-");
  return `${date}/${month}/${year}`;
}

function percent(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

function PeriodFilters({
  action,
  period,
  hidden = {},
  sectors,
  sectorId,
  label,
}: {
  action: string;
  period: ReportPeriod;
  hidden?: Record<string, string>;
  /** Only the administrator chooses a sector. */
  sectors?: ReportSector[];
  sectorId?: string | null;
  label: string;
}) {
  const custom = period.option === "custom";
  return (
    <form method="get" action={action} className="surface-card dashboard-filters" aria-label={label}>
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {sectors ? (
        <div className="search-field">
          <label htmlFor="analytics-sector">Setor</label>
          <select id="analytics-sector" name="sector" defaultValue={sectorId ?? ""}>
            <option value="">Toda a organização</option>
            {sectors.map((sector) => (
              <option key={sector.id} value={sector.id}>
                {sector.isActive ? sector.name : `${sector.name} (inativo)`}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="search-field">
        <label htmlFor="analytics-period">Período</label>
        <select id="analytics-period" name="period" defaultValue={period.option}>
          <option value="7">Últimos 7 dias</option>
          <option value="30">Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option>
          <option value="custom">Intervalo de datas</option>
        </select>
      </div>
      <div className="search-field">
        <label htmlFor="analytics-from">De</label>
        <input id="analytics-from" name="from" type="date" defaultValue={custom ? period.firstDay : ""} />
      </div>
      <div className="search-field">
        <label htmlFor="analytics-to">Até</label>
        <input id="analytics-to" name="to" type="date" defaultValue={custom ? period.lastDay : ""} />
      </div>
      <button type="submit">Aplicar</button>
      <p className="metadata wide-field">As datas valem só para &quot;Intervalo de datas&quot;. Dias contados no horário de Brasília.</p>
    </form>
  );
}

function Alerts({ messages }: { messages: string[] }) {
  return (
    <>
      {messages.map((message) => (
        <p className="feedback feedback-error" role="alert" key={message}>
          {message}
        </p>
      ))}
    </>
  );
}

const WITHOUT_SECTOR = "Você não está ligado a um setor ativo, então não há números para mostrar.";

function periodMessage(error: keyof typeof PERIOD_ERRORS | null): string[] {
  return error ? [`${PERIOD_ERRORS[error]} Mostrando os últimos 30 dias.`] : [];
}

function WorkIndicators({ mine, sector }: { mine: WorkSummary; sector: WorkSummary }) {
  const time = (summary: WorkSummary) => (summary.completion ? hours(summary.completion.averageHours) : "—");
  return (
    <dl className="dashboard-indicators">
      <Indicator label="Concluídas por mim" value={String(mine.completed)} detail={`setor: ${sector.completed}`} />
      <Indicator
        label="Meu tempo até a conclusão"
        value={time(mine)}
        detail={`${mine.completion ? `mediana ${hours(mine.completion.medianHours)} · ` : ""}setor: ${time(sector)}`}
      />
      <Indicator label="Concluídas no prazo" value={percent(mine.onTimePercentage)} detail={`setor: ${percent(sector.onTimePercentage)}`} />
      <Indicator label="Respostas que escrevi" value={String(mine.replies)} detail={`setor: ${sector.replies}`} />
    </dl>
  );
}

/** "Meu painel" of the attendant (5.3). */
export function AttendantDashboardView({ dashboard }: { dashboard: AttendantDashboard }) {
  const { period, queue } = dashboard;

  return (
    <div className="dashboard analytics">
      <PeriodFilters action="/queue/dashboard" period={period} label="Filtros do meu painel" />
      <Alerts messages={periodMessage(dashboard.periodError)} />
      {dashboard.withoutSector ? <p className="empty-state">{WITHOUT_SECTOR}</p> : null}

      <section className="surface-card" aria-labelledby="queue-now">
        <h2 id="queue-now">Fila agora</h2>
        <p className="metadata">{dashboard.sectorName ?? "Seu setor"} · abertas e em atendimento, independentemente do período.</p>
        <dl className="dashboard-indicators">
          <Indicator label="Sem responsável" value={String(queue.unassigned)} detail="sem aprovação pendente" />
          <Indicator label="Comigo" value={String(queue.mine)} />
          <Indicator label="Próximas do vencimento" value={String(queue.dueSoon)} />
          <Indicator label="Vencidas" value={String(queue.overdue)} />
          <Indicator label="Prazo pausado" value={String(queue.paused)} />
        </dl>
        <div className="dashboard-groups">
          <GroupTable title="Por prioridade" groups={queue.byPriority} />
          {queue.byStage.length > 0 ? (
            <GroupTable title="Em atendimento, por etapa" groups={queue.byStage} />
          ) : (
            <section className="dashboard-group" aria-label="Em atendimento, por etapa">
              <h3>Em atendimento, por etapa</h3>
              <p className="metadata">Nenhuma solicitação em atendimento.</p>
            </section>
          )}
        </div>
      </section>

      <section className="surface-card" aria-labelledby="my-period">
        <h2 id="my-period">Meu período</h2>
        <p className="metadata">
          Solicitações do setor em que você é o responsável · de {day(period.firstDay)} a {day(period.lastDay)}. Ao lado, o total do
          setor, para referência.
        </p>
        <WorkIndicators mine={dashboard.mine} sector={dashboard.sector} />
      </section>
    </div>
  );
}

/** "Análises" of the administrator and the manager (5.4 to 5.6). */
export function AnalyticsView({ analytics, action, hidden = {} }: { analytics: Analytics; action: string; hidden?: Record<string, string> }) {
  const { period, trend, sla } = analytics;
  const scopeName = analytics.sector?.name ?? (analytics.audience === "organization" ? "Toda a organização" : "Seu setor");
  const intervalNote = analytics.granularity === "day" ? "Por dia." : "Por semana (segunda a domingo).";
  const messages = [
    ...periodMessage(analytics.errors.period),
    ...(analytics.errors.sector ? ["Setor não encontrado. Mostrando toda a organização."] : []),
  ];

  return (
    <div className="dashboard analytics">
      <PeriodFilters
        action={action}
        hidden={hidden}
        period={period}
        label="Filtros das análises"
        sectors={analytics.audience === "organization" ? analytics.sectors : undefined}
        sectorId={analytics.sector?.id ?? null}
      />
      <Alerts messages={messages} />
      {analytics.withoutSector ? <p className="empty-state">{WITHOUT_SECTOR}</p> : null}

      <section className="surface-card" aria-labelledby="analytics-trends">
        <h2 id="analytics-trends">Tendências</h2>
        <p className="metadata">
          {scopeName} · de {day(period.firstDay)} a {day(period.lastDay)}. {intervalNote}
        </p>
        <div className="analytics-charts">
          <ColumnPairChart
            id="trend-flow"
            title="Abertas e concluídas"
            names={["Abertas", "Concluídas"]}
            points={trend.map((point) => ({ label: point.label, first: point.opened, second: point.completed }))}
          />
          <LineChart
            id="trend-pending"
            title="Pendentes ao fim de cada intervalo"
            note="Abertas ou em atendimento, pelo último status de cada solicitação."
            valueName="Pendentes"
            points={trend.map((point) => ({ label: point.label, value: point.pendingAtEnd }))}
          />
          <LineChart
            id="trend-ontime"
            title="Concluídas no prazo (%)"
            note="Entre as concluídas com prazo; intervalos sem nenhuma ficam sem ponto."
            valueName="No prazo"
            unit="%"
            fixedMax={100}
            points={trend.map((point) => ({ label: point.label, value: point.onTimePercentage }))}
          />
        </div>
      </section>

      <section className="surface-card" aria-labelledby="analytics-sla">
        <h2 id="analytics-sla">SLA e tempos</h2>
        <dl className="dashboard-indicators">
          <Indicator
            label="Primeira resposta"
            value={sla.firstResponse.times ? hours(sla.firstResponse.times.averageHours) : "—"}
            detail={`${sla.firstResponse.times ? `mediana ${hours(sla.firstResponse.times.medianHours)} · ` : ""}${sla.firstResponse.unanswered} ainda sem resposta`}
          />
          <Indicator
            label="Concluídas com pausa"
            value={`${sla.pauses.withPause} de ${sla.pauses.completed}`}
            detail={sla.pauses.times ? `tempo pausado médio ${hours(sla.pauses.times.averageHours)}` : undefined}
          />
        </dl>
        <p className="metadata">
          Primeira resposta: da abertura até o primeiro comentário público de um atendente ou o início do atendimento, o que vier primeiro;
          notas internas não contam.
        </p>

        <section className="dashboard-group" aria-label="Tempo por etapa">
          <h3>Tempo por etapa</h3>
          {sla.stages.length === 0 ? (
            <p className="metadata">Nenhuma concluída no período passou por etapas.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Serviço · etapa</th>
                  <th scope="col">Média</th>
                  <th scope="col">Mediana</th>
                  <th scope="col">Passagens</th>
                </tr>
              </thead>
              <tbody>
                {sla.stages.map((stage) => (
                  <tr key={`${stage.serviceName}·${stage.stageName}`}>
                    <th scope="row">
                      {stage.serviceName} · {stage.stageName}
                    </th>
                    <td>{stage.times ? hours(stage.times.averageHours) : "—"}</td>
                    <td>{stage.times ? hours(stage.times.medianHours) : "—"}</td>
                    <td>{stage.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <div className="dashboard-groups">
          <PercentBars caption="No prazo por serviço" groups={sla.onTimeByService} />
          <PercentBars caption="No prazo por prioridade" groups={sla.onTimeByPriority} />
        </div>
        <ArrivalHeatmap grid={sla.arrivals} />
      </section>

      <section className="surface-card" aria-labelledby="analytics-team">
        <h2 id="analytics-team">Desempenho da equipe</h2>
        <p className="analytics-notice">{TEAM_NOTICE}</p>
        {analytics.team.length === 0 ? (
          <p className="metadata">Nenhum atendente com solicitações concluídas no período ou pendentes agora.</p>
        ) : (
          <div className="heatmap-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Pessoa</th>
                  {analytics.teamShowsSector ? <th scope="col">Setor</th> : null}
                  <th scope="col">Concluídas no período</th>
                  <th scope="col">Tempo médio</th>
                  <th scope="col">No prazo</th>
                  <th scope="col">Pendentes agora</th>
                </tr>
              </thead>
              <tbody>
                {analytics.team.map((member) => (
                  <tr key={member.userId}>
                    <th scope="row">{member.isActive ? member.name : `${member.name} (inativa)`}</th>
                    {analytics.teamShowsSector ? <td>{member.sectorName ?? "—"}</td> : null}
                    <td>{member.completed}</td>
                    <td>{member.completion ? hours(member.completion.averageHours) : "—"}</td>
                    <td>{percent(member.onTimePercentage)}</td>
                    <td>{member.pendingNow}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="metadata">Em ordem alfabética. Cada pessoa aparece pelas solicitações em que é a responsável.</p>
      </section>
    </div>
  );
}
