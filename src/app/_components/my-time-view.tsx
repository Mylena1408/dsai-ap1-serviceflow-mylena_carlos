import { formatMinutes, type MyTime } from "@/modules/time-entries";
import { dayLabel } from "./request-time";

// "Minhas horas" in "Meu painel" (SPEC 2026-11-08-atendimento-dia-a-dia, 13.2 item 2; decision J5): the attendant's
// own hours in the period chosen at the top of the page, by day and by service.

export function MyTimeView({ time, period }: { time: MyTime; period: { firstDay: string; lastDay: string } }) {
  return (
    <section aria-labelledby="my-time-heading" className="surface-card content-section">
      <h2 id="my-time-heading">Minhas horas</h2>
      <p className="metadata">
        As horas que você lançou de {dayLabel(period.firstDay)} a {dayLabel(period.lastDay)}, em qualquer solicitação.
      </p>
      <p>
        <strong>Total: {formatMinutes(time.totalMinutes)}</strong>
      </p>
      {time.totalMinutes === 0 ? (
        <p className="section-description">Nenhuma hora lançada no período.</p>
      ) : (
        <>
          <table className="data-table">
            <caption>Minhas horas por dia</caption>
            <thead>
              <tr>
                <th scope="col">Dia</th>
                <th scope="col">Horas</th>
              </tr>
            </thead>
            <tbody>
              {time.byDay.map((row) => (
                <tr key={row.day}>
                  <td>{dayLabel(row.day)}</td>
                  <td>{formatMinutes(row.minutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="data-table">
            <caption>Minhas horas por serviço</caption>
            <thead>
              <tr>
                <th scope="col">Serviço</th>
                <th scope="col">Horas</th>
                <th scope="col">Lançamentos</th>
              </tr>
            </thead>
            <tbody>
              {time.byService.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>{formatMinutes(row.minutes)}</td>
                  <td>{row.entries}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
