import { MAX_ABSENCE_DAYS, absenceInForce, canCancelAbsence, type AttendantAbsenceOverview, type AttendantAbsenceRecord } from "@/modules/absences";
import { cancelAttendantAbsenceAction, registerAttendantAbsenceAction } from "./attendant-absence-actions";

// Attendants' absences (SPEC 2026-11-07-operacao-e-automacao, 4.3 item 7), shared by the administration,
// the manager's area and the attendant's area. During an absence the person receives nothing by the
// distribution and, where the sector chose it, their requests go to colleagues when it starts.

const MESSAGES: Record<string, { text: string; error: boolean }> = {
  "attendant-absence-registered": { text: "Ausência registrada.", error: false },
  "attendant-absence-cancelled": { text: "Ausência cancelada.", error: false },
  "attendant-absence-period": {
    text: `Informe um período de até ${MAX_ABSENCE_DAYS} dias, com o fim depois do início e ainda não encerrado.`,
    error: true,
  },
  "attendant-absence-conflict": { text: "Não foi possível: o período coincide com outra ausência da pessoa, ou a ausência já terminou.", error: true },
  "attendant-absence-missing": { text: "A pessoa ou a ausência não está disponível para você.", error: true },
  "attendant-absence-invalid": { text: "Os dados enviados são inválidos.", error: true },
  "attendant-absence-unexpected": { text: "Não foi possível concluir a operação.", error: true },
};

export function attendantAbsenceMessage(code: string | undefined): { text: string; error: boolean } | null {
  return code ? (MESSAGES[code] ?? null) : null;
}

function dayText(day: string): string {
  const [year, month, date] = day.split("-");
  return `${date}/${month}/${year}`;
}

/** "Em vigor · solicitações passadas" and the like. */
export function attendantAbsenceSituation(absence: AttendantAbsenceRecord, today: string): string {
  if (absence.cancelledAt) return "Cancelada";
  const base = absenceInForce(absence, today) ? "Em vigor" : absence.endsOn < today ? "Encerrada" : "Agendada";
  return absence.redistributedAt ? `${base} · solicitações passadas a colegas` : base;
}

export function AttendantAbsences({
  overview,
  area,
  message,
}: {
  overview: AttendantAbsenceOverview;
  /** Where the forms go back to; the attendant registers only their own absence. */
  area: "queue" | "approvals" | "admin";
  message?: string;
}) {
  const feedback = attendantAbsenceMessage(message);
  const forSomeone = area !== "queue";

  return (
    <section className="surface-card content-section" aria-labelledby="attendant-absences-heading">
      <h2 id="attendant-absences-heading">Ausências de atendentes</h2>
      <p className="section-description">
        Durante a ausência, a pessoa não recebe solicitações pela distribuição automática. Se o setor escolheu, as solicitações dela
        passam a colegas no primeiro dia.
      </p>
      {feedback ? (
        <p className={`feedback${feedback.error ? " feedback-error" : ""}`} role={feedback.error ? "alert" : "status"}>
          {feedback.text}
        </p>
      ) : null}

      {forSomeone && overview.attendants.length === 0 ? (
        <p>Nenhum atendente ativo para registrar ausência.</p>
      ) : (
        <form action={registerAttendantAbsenceAction} aria-label="Registrar ausência de atendente" className="create-form">
          <input name="area" type="hidden" value={area} />
          {forSomeone ? (
            <label>
              Atendente
              <select name="userId" required>
                {overview.attendants.map((attendant) => (
                  <option key={attendant.id} value={attendant.id}>
                    {attendant.sectorName ? `${attendant.name} (${attendant.sectorName})` : attendant.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            Início
            <input min={overview.today} name="startsOn" required type="date" />
          </label>
          <label>
            Fim
            <input min={overview.today} name="endsOn" required type="date" />
          </label>
          <button type="submit">Registrar ausência</button>
        </form>
      )}

      {overview.absences.length === 0 ? (
        <p>Nenhuma ausência registrada.</p>
      ) : (
        <table className="data-table">
          <caption>Ausências de atendentes registradas</caption>
          <thead>
            <tr>
              <th scope="col">Atendente</th>
              <th scope="col">Período</th>
              <th scope="col">Situação</th>
              <th scope="col">Ação</th>
            </tr>
          </thead>
          <tbody>
            {overview.absences.map((absence) => (
              <tr key={absence.id}>
                <td>{absence.attendant.sectorName ? `${absence.attendant.name} (${absence.attendant.sectorName})` : absence.attendant.name}</td>
                <td>
                  {dayText(absence.startsOn)} a {dayText(absence.endsOn)}
                </td>
                <td>{attendantAbsenceSituation(absence, overview.today)}</td>
                <td>
                  {canCancelAbsence(absence, overview.today) ? (
                    <form action={cancelAttendantAbsenceAction}>
                      <input name="area" type="hidden" value={area} />
                      <input name="absenceId" type="hidden" value={absence.id} />
                      <button className="button-secondary" type="submit">
                        Cancelar
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
