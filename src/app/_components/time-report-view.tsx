import { formatMinutes, type TimeReport } from "@/modules/time-entries";
import { Alerts, HoursTable as GroupTable, PeriodFilters, periodMessage } from "./analytics-view";

// The time report (SPEC 2026-11-08-atendimento-dia-a-dia, 5.1 item 3 and 5.3 item 4), shared by the manager's area
// (their sector) and the administration (every sector or one): the period's hours by attendant, service and sector,
// with the CSV of the entries.

function day(value: string): string {
  const [year, month, date] = value.split("-");
  return `${date}/${month}/${year}`;
}

/** The CSV link keeps the same period and sector as the screen. */
export function timeCsvHref(report: Pick<TimeReport, "period" | "sector" | "audience">): string {
  const params = new URLSearchParams({ period: report.period.option });
  if (report.period.option === "custom") {
    params.set("from", report.period.firstDay);
    params.set("to", report.period.lastDay);
  }
  if (report.audience === "organization" && report.sector) params.set("sector", report.sector.id);
  return `/api/reports/hours.csv?${params.toString()}`;
}

export function TimeReportView({ report, action, hidden = {} }: { report: TimeReport; action: string; hidden?: Record<string, string> }) {
  const messages = [
    ...periodMessage(report.errors.period),
    ...(report.errors.sector ? ["Setor não encontrado. Mostrando toda a organização."] : []),
  ];
  const scopeName = report.sector?.name ?? (report.audience === "organization" ? "Toda a organização" : "Seu setor");

  return (
    <>
      <PeriodFilters
        action={action}
        hidden={hidden}
        label="Filtros do relatório de horas"
        period={report.period}
        sectorId={report.sector?.id ?? null}
        sectors={report.audience === "organization" ? report.sectors : undefined}
      />
      <Alerts messages={messages} />
      {report.withoutSector ? (
        <p className="feedback">Você não está ligado a um setor ativo, então não há horas para mostrar.</p>
      ) : (
        <section aria-labelledby="time-report-heading" className="surface-card content-section">
          <h2 id="time-report-heading">Horas lançadas</h2>
          <p className="metadata">
            {scopeName} · de {day(report.period.firstDay)} a {day(report.period.lastDay)}, pelo dia de cada lançamento.
          </p>
          <p>
            <strong>Total: {formatMinutes(report.totalMinutes)}</strong>
          </p>
          {report.totalMinutes === 0 ? (
            <p className="section-description">Nenhuma hora lançada no período.</p>
          ) : (
            <>
              <GroupTable caption="Horas por atendente" groups={report.byAttendant} label="Atendente" />
              <GroupTable caption="Horas por serviço" groups={report.byService} label="Serviço" />
              {report.audience === "organization" && report.sector === null ? (
                <GroupTable caption="Horas por setor" groups={report.bySector} label="Setor" />
              ) : null}
              {/* SPEC 2026-11-08-atendimento-dia-a-dia, 13.2 item 3: a request with two tags counts in both. */}
              {report.byTag.length > 0 ? <GroupTable caption="Horas por etiqueta" groups={report.byTag} label="Etiqueta" /> : null}
              {/* SPEC 2026-11-08-atendimento-dia-a-dia, 13.2 item 1 (decision J4). */}
              {report.estimates.length > 0 ? (
                <table className="data-table">
                  <caption>Média apontada contra a estimativa (solicitações concluídas no período)</caption>
                  <thead>
                    <tr>
                      <th scope="col">Serviço</th>
                      <th scope="col">Concluídas com horas</th>
                      <th scope="col">Média apontada</th>
                      <th scope="col">Estimativa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.estimates.map((row) => (
                      <tr key={row.serviceId}>
                        <td>{row.serviceName}</td>
                        <td>{row.completed}</td>
                        <td>{formatMinutes(row.averageMinutes)}</td>
                        <td>{row.estimatedHours === null ? "—" : `${row.estimatedHours}h`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </>
          )}
          <p>
            <a download href={timeCsvHref(report)}>
              Exportar lançamentos (CSV)
            </a>
          </p>
        </section>
      )}
    </>
  );
}
