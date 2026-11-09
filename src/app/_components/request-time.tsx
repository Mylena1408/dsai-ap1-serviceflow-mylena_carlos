import { MAX_ENTRY_NOTE_LENGTH, estimateLabel, formatMinutes, type RequestTimeView, type TimeEntryView, type TimeEventView } from "@/modules/time-entries";

// A request's time on the team's screens (SPEC 2026-11-08-atendimento-dia-a-dia, 5.1 item 2, 5.3 and 13.2 item 1;
// decision I9): the total against the service's estimate, the total by person and the entries; the attendant logs
// time and changes or removes their own entries. The requester never sees it.

type TimeAction = (formData: FormData) => Promise<never>;

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

/** The page's messages for the time's results. */
export function timeFeedback(code: string | undefined): string | null {
  if (code === "time-logged") return "Horas lançadas.";
  if (code === "time-updated") return "Lançamento alterado.";
  if (code === "time-deleted") return "Lançamento apagado. O histórico guarda o registro.";
  if (code === "time-day") return "Escolha um dia entre a abertura da solicitação e hoje.";
  if (code === "time-duration") return "Informe de 1 minuto a 12 horas, com os minutos entre 0 e 59.";
  if (code === "time-note") return `Escreva a nota com até ${MAX_ENTRY_NOTE_LENGTH} caracteres.`;
  if (code === "time-state")
    return "Não é possível mudar as horas agora: a solicitação foi cancelada ou concluída há mais de 7 dias, ou o lançamento passou de 7 dias.";
  return null;
}

/** The day, hours, minutes and note fields, with the current values when changing an entry. */
function TimeFields({ view, entry }: { view: RequestTimeView; entry?: TimeEntryView }) {
  return (
    <>
      <label>
        Dia
        <input defaultValue={entry?.workedOn ?? view.today} max={view.today} min={view.openedOn} name="workedOn" required type="date" />
      </label>
      <label>
        Horas
        <input defaultValue={entry ? Math.floor(entry.minutes / 60) : 0} max={12} min={0} name="hours" required type="number" />
      </label>
      <label>
        Minutos
        <input defaultValue={entry ? entry.minutes % 60 : 30} max={59} min={0} name="minutes" required type="number" />
      </label>
      <label>
        Nota (opcional)
        <input defaultValue={entry?.note ?? ""} maxLength={MAX_ENTRY_NOTE_LENGTH} name="note" />
      </label>
    </>
  );
}

export function RequestTime({
  requestId,
  view,
  edit,
}: {
  requestId: string;
  view: RequestTimeView;
  /** The attendant's actions; without them the block only shows the time. */
  edit?: { logAction: TimeAction; updateAction: TimeAction; deleteAction: TimeAction };
}) {
  // Nothing logged and nobody may log: nothing to show (CA-HRS-01).
  if (view.entries.length === 0 && !view.canLog) return null;
  const canLog = Boolean(edit) && view.canLog;

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
      {canLog && edit ? (
        <form action={edit.logAction} aria-label="Lançar horas" className="inline-form">
          <input name="requestId" type="hidden" value={requestId} />
          <TimeFields view={view} />
          <button type="submit">Lançar horas</button>
        </form>
      ) : null}
      {view.entries.length > 0 ? (
        <table className="data-table">
          <caption>Lançamentos</caption>
          <thead>
            <tr>
              <th scope="col">Dia</th>
              <th scope="col">Duração</th>
              <th scope="col">Quem</th>
              <th scope="col">Nota</th>
              {edit ? <th scope="col">Ações</th> : null}
            </tr>
          </thead>
          <tbody>
            {view.entries.map((entry) => (
              <tr key={entry.id}>
                <td>{dayLabel(entry.workedOn)}</td>
                <td>{formatMinutes(entry.minutes)}</td>
                <td>{entry.userName}</td>
                <td>{entry.note ?? "—"}</td>
                {edit ? (
                  <td>
                    {entry.canChange ? (
                      <>
                        <details>
                          <summary>Alterar</summary>
                          <form action={edit.updateAction} aria-label={`Alterar o lançamento de ${dayLabel(entry.workedOn)}`} className="inline-form">
                            <input name="requestId" type="hidden" value={requestId} />
                            <input name="entryId" type="hidden" value={entry.id} />
                            <TimeFields entry={entry} view={view} />
                            <button type="submit">Salvar</button>
                          </form>
                        </details>
                        <form action={edit.deleteAction}>
                          <input name="requestId" type="hidden" value={requestId} />
                          <input name="entryId" type="hidden" value={entry.id} />
                          <button aria-label={`Apagar o lançamento de ${dayLabel(entry.workedOn)}`} className="button-secondary" type="submit">
                            Apagar
                          </button>
                        </form>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
