import { estimateLabel, formatMinutes, type RequestTimeView, type TimeEventView } from "@/modules/time-entries";

// A request's time on the team's screens (SPEC 2026-11-08-atendimento-dia-a-dia, 5.1 item 2 and 13.2 item 1;
// decision I9): the total against the service's estimate, the total by person and the entries. The requester never
// sees it.

/** "12/11/2026" from "2026-11-12". */
export function dayLabel(day: string): string {
  const [year, month, date] = day.split("-");
  return `${date}/${month}/${year}`;
}

/** 5.3 item 3: the history line of each change. */
export function timeEventTitle(event: Pick<TimeEventView, "action" | "minutes" | "workedOn">): string {
  const what = `${formatMinutes(event.minutes)} em ${dayLabel(event.workedOn)}`;
  if (event.action === "CREATED") return `Horas lançadas: ${what}`;
  if (event.action === "UPDATED") return `Horas alteradas: ${what}`;
  return `Horas apagadas: ${what}`;
}

export function RequestTime({ view, children }: { view: RequestTimeView; children?: React.ReactNode }) {
  // Nothing logged and nobody may log: nothing to show (CA-HRS-01).
  if (view.entries.length === 0 && !view.canLog) return null;

  return (
    <section aria-labelledby="time-heading" className="surface-card content-section" id="time">
      <p className="eyebrow">Atendimento</p>
      <h2 id="time-heading">Horas</h2>
      <p>
        <strong>Total: {estimateLabel(view.totalMinutes, view.estimatedHours)}</strong>
        <span className="section-description"> · Só a equipe vê as horas.</span>
      </p>
      {view.byPerson.length > 0 ? (
        <ul aria-label="Horas por pessoa" className="metadata">
          {view.byPerson.map((person) => (
            <li key={person.userId}>
              {person.name}: {formatMinutes(person.minutes)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="section-description">Nenhuma hora lançada.</p>
      )}
      {children}
      {view.entries.length > 0 ? (
        <table className="data-table">
          <caption>Lançamentos</caption>
          <thead>
            <tr>
              <th scope="col">Dia</th>
              <th scope="col">Duração</th>
              <th scope="col">Quem</th>
              <th scope="col">Nota</th>
            </tr>
          </thead>
          <tbody>
            {view.entries.map((entry) => (
              <tr key={entry.id}>
                <td>{dayLabel(entry.workedOn)}</td>
                <td>{formatMinutes(entry.minutes)}</td>
                <td>{entry.userName}</td>
                <td>{entry.note ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
