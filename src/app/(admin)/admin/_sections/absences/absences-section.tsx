import { MAX_ABSENCE_DAYS, absenceInForce, canCancelAbsence, type AbsenceRecord } from "@/modules/absences";
import { cancelAbsenceByAdminAction, registerAbsenceByAdminAction } from "./actions";

// "Ausências" of the administration (SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.5): every
// manager's absence, the form to register one for any manager, and the cancellation.

export interface AbsencesOverview {
  today: string;
  absences: AbsenceRecord[];
  /** Active managers, by name, with their sector. */
  managers: Array<{ id: string; name: string; sectorName: string | null }>;
}

const MESSAGES: Record<string, { text: string; error: boolean }> = {
  "absence-registered": { text: "Ausência registrada.", error: false },
  "absence-cancelled": { text: "Ausência cancelada.", error: false },
  "absence-period": {
    text: `Informe um período de até ${MAX_ABSENCE_DAYS} dias, com o fim depois do início e ainda não encerrado.`,
    error: true,
  },
  "absence-conflict": {
    text: "Não foi possível: o período coincide com outra ausência do gestor, o substituto não é outro gestor ativo ou está ausente o período inteiro, ou a ausência já terminou.",
    error: true,
  },
  "absence-missing": { text: "O gestor ou a ausência não está disponível.", error: true },
  "absence-invalid": { text: "Os dados enviados são inválidos.", error: true },
  "absence-unexpected": { text: "Não foi possível concluir a operação.", error: true },
};

/** The fixed message of an absence notice or error code, if it is one. */
export function absenceMessage(code: string | undefined): { text: string; error: boolean } | null {
  return code ? (MESSAGES[code] ?? null) : null;
}

function dayText(day: string): string {
  const [year, month, date] = day.split("-");
  return `${date}/${month}/${year}`;
}

function situation(absence: AbsenceRecord, today: string): string {
  if (absence.cancelledAt) return "Cancelada";
  if (absenceInForce(absence, today)) return "Em vigor";
  return absence.endsOn < today ? "Encerrada" : "Agendada";
}

function person(item: { name: string; sectorName: string | null }): string {
  return item.sectorName ? `${item.name} (${item.sectorName})` : item.name;
}

export function AbsencesSection({ overview, message }: { overview: AbsencesOverview; message: string | undefined }) {
  const { today, absences, managers } = overview;
  const feedback = absenceMessage(message);

  return (
    <section className="admin-section" aria-labelledby="absences-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Aprovações</p>
          <h2 id="absences-heading">Ausências</h2>
          <p className="section-description">
            Durante a ausência de um gestor, o substituto também vê, decide e é avisado das aprovações do setor dele. O gestor
            ausente continua podendo decidir.
          </p>
        </div>
      </div>
      {feedback ? (
        <p className={`feedback${feedback.error ? " feedback-error" : ""}`} role={feedback.error ? "alert" : "status"}>
          {feedback.text}
        </p>
      ) : null}

      {managers.length < 2 ? (
        <p>É preciso pelo menos dois gestores ativos para registrar uma ausência.</p>
      ) : (
        <form action={registerAbsenceByAdminAction} className="create-form">
          <label>
            Gestor ausente
            <select name="managerId" required>
              {managers.map((manager) => (
                <option key={manager.id} value={manager.id}>
                  {person(manager)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Substituto
            <select name="substituteId" required>
              {managers.map((manager) => (
                <option key={manager.id} value={manager.id}>
                  {person(manager)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Início
            <input min={today} name="startsOn" required type="date" />
          </label>
          <label>
            Fim
            <input min={today} name="endsOn" required type="date" />
          </label>
          <button type="submit">Registrar ausência</button>
        </form>
      )}

      {absences.length === 0 ? (
        <p>Nenhuma ausência registrada.</p>
      ) : (
        <table className="data-table">
          <caption>Ausências registradas</caption>
          <thead>
            <tr>
              <th scope="col">Gestor</th>
              <th scope="col">Substituto</th>
              <th scope="col">Período</th>
              <th scope="col">Situação</th>
              <th scope="col">Ação</th>
            </tr>
          </thead>
          <tbody>
            {absences.map((absence) => (
              <tr key={absence.id}>
                <td>{person(absence.manager)}</td>
                <td>{person(absence.substitute)}</td>
                <td>
                  {dayText(absence.startsOn)} a {dayText(absence.endsOn)}
                </td>
                <td>{situation(absence, today)}</td>
                <td>
                  {canCancelAbsence(absence, today) ? (
                    <form action={cancelAbsenceByAdminAction}>
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
