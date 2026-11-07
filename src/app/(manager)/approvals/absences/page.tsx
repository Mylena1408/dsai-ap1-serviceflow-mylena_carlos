import { MAX_ABSENCE_DAYS, absenceInForce, canCancelAbsence, listAbsences, listSubstituteCandidates } from "@/modules/absences";
import { requireManagerPageAccess } from "../../page-access";
import { cancelAbsenceAction, registerAbsenceAction } from "./actions";

// "Ausências" of the manager (SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.5): the own
// absences, the substitutions received, and the form to register one.

type AbsencesPageProps = { searchParams: Promise<{ error?: string; notice?: string }> };

function feedback(error?: string, notice?: string): string | null {
  if (notice === "registered") return "Ausência registrada.";
  if (notice === "cancelled") return "Ausência cancelada.";
  if (error === "period") return `Informe um período de até ${MAX_ABSENCE_DAYS} dias, com o fim depois do início e ainda não encerrado.`;
  if (error === "conflict")
    return "Não foi possível registrar: o período coincide com outra ausência sua, o substituto está ausente o período inteiro ou não é um gestor ativo, ou a ausência já terminou.";
  if (error === "missing") return "A ausência não está disponível.";
  if (error === "validation") return "Os dados enviados são inválidos.";
  if (error === "unexpected") return "Não foi possível concluir a operação.";
  return null;
}

/** "2026-11-07" as "07/11/2026". */
function dayText(day: string): string {
  const [year, month, date] = day.split("-");
  return `${date}/${month}/${year}`;
}

function situation(absence: { cancelledAt: Date | null; startsOn: string; endsOn: string }, today: string): string {
  if (absence.cancelledAt) return "Cancelada";
  if (absenceInForce(absence, today)) return "Em vigor";
  return absence.endsOn < today ? "Encerrada" : "Agendada";
}

export default async function AbsencesPage({ searchParams }: AbsencesPageProps) {
  const manager = await requireManagerPageAccess();
  const [{ error, notice }, { today, absences }, candidates] = await Promise.all([
    searchParams,
    listAbsences(),
    listSubstituteCandidates(),
  ]);
  const message = feedback(error, notice);
  const own = absences.filter((absence) => absence.manager.id === manager.id);
  const received = absences.filter((absence) => absence.substitute.id === manager.id);

  return (
    <main className="page-shell">
      <header className="detail-heading">
        <p className="eyebrow">Aprovações</p>
        <h1>Ausências</h1>
        <p>
          Durante a sua ausência, o substituto também vê e decide as aprovações do seu setor. Você continua podendo decidir.
        </p>
      </header>
      {message ? (
        <p className={`feedback${error ? " feedback-error" : ""}`} role={error ? "alert" : "status"}>
          {message}
        </p>
      ) : null}

      <section className="surface-card content-section" aria-labelledby="register-heading">
        <h2 id="register-heading">Registrar ausência</h2>
        {candidates.length === 0 ? (
          <p>Não há outro gestor ativo para ser o substituto.</p>
        ) : (
          <form action={registerAbsenceAction} className="lifecycle-form">
            <label>
              Substituto
              <select name="substituteId" required>
                {candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                    {candidate.sectorName ? ` (${candidate.sectorName})` : ""}
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
      </section>

      <section className="surface-card content-section" aria-labelledby="own-heading">
        <h2 id="own-heading">Minhas ausências</h2>
        {own.length === 0 ? (
          <p>Nenhuma ausência registrada.</p>
        ) : (
          <ul className="entity-list">
            {own.map((absence) => (
              <li key={absence.id}>
                <p>
                  {dayText(absence.startsOn)} a {dayText(absence.endsOn)}, substituto: {absence.substitute.name} — {situation(absence, today)}
                </p>
                {canCancelAbsence(absence, today) ? (
                  <form action={cancelAbsenceAction}>
                    <input name="absenceId" type="hidden" value={absence.id} />
                    <button className="button-secondary" type="submit">Cancelar ausência</button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="surface-card content-section" aria-labelledby="received-heading">
        <h2 id="received-heading">Substituições</h2>
        {received.length === 0 ? (
          <p>Você não substitui ninguém.</p>
        ) : (
          <ul className="entity-list">
            {received.map((absence) => (
              <li key={absence.id}>
                <p>
                  {absence.manager.name}
                  {absence.manager.sectorName ? ` (${absence.manager.sectorName})` : ""}: {dayText(absence.startsOn)} a{" "}
                  {dayText(absence.endsOn)} — {situation(absence, today)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
