import Link from "next/link";
import {
  FAILURES_TO_PAUSE,
  MAX_ACTIVE_SCHEDULES,
  SCHEDULE_STATUS_LABELS,
  SKIP_REASON_LABELS,
  frequencyText,
  type ScheduleRun,
  type ScheduleView,
} from "@/modules/recurring-requests";
import { endScheduleAction, pauseScheduleAction, resumeScheduleAction, updateScheduleAction, createScheduleAction } from "./recurring-schedule-actions";
import { ScheduleForm } from "./recurring-schedule-form";
import type { ScheduleScreen } from "./recurring-schedule-screen";

// Schedules of recurring requests (SPEC 2026-11-07-operacao-e-automacao, 5.3 item 4), shared by the
// administration and the manager's area: the list with the next day, the state and the latest runs, and
// the forms to create, change, pause, resume and end. The job opens the requests (SF-186).

const MESSAGES: Record<string, { text: string; error: boolean }> = {
  "schedule-created": { text: "Agenda criada.", error: false },
  "schedule-updated": { text: "Agenda alterada.", error: false },
  "schedule-paused": { text: "Agenda pausada.", error: false },
  "schedule-resumed": { text: "Agenda retomada.", error: false },
  "schedule-ended": { text: "Agenda encerrada.", error: false },
  "schedule-fields": { text: "Revise as informações do serviço indicadas abaixo.", error: true },
  "schedule-fields-changed": { text: "O formulário do serviço mudou. Revise as informações e salve de novo.", error: true },
  "schedule-dates": {
    text: "Informe o início a partir de hoje e, se houver fim, até 2 anos depois do início e não antes dele.",
    error: true,
  },
  "schedule-frequency": { text: "Marque ao menos um dia da semana, ou informe o dia do mês de 1 a 28.", error: true },
  "schedule-requester": { text: "Escolha um solicitante ativo.", error: true },
  "schedule-service": {
    text: "O serviço não pode ser agendado: precisa estar ativo, no catálogo e sem documentos exigidos.",
    error: true,
  },
  "schedule-limit": { text: `A organização já tem ${MAX_ACTIVE_SCHEDULES} agendas em vigor. Encerre alguma antes de criar outra.`, error: true },
  "schedule-state": { text: "A agenda mudou de estado. Confira a lista e tente de novo.", error: true },
  "schedule-missing": { text: "A agenda ou o serviço não está disponível para você.", error: true },
  "schedule-invalid": { text: "Os dados enviados são inválidos.", error: true },
  "schedule-unexpected": { text: "Não foi possível concluir a operação.", error: true },
};

export function scheduleMessage(code: string | undefined): { text: string; error: boolean } | null {
  return code ? (MESSAGES[code] ?? null) : null;
}

function dayText(day: string): string {
  const [year, month, date] = day.split("-");
  return `${date}/${month}/${year}`;
}

export function periodText(schedule: Pick<ScheduleView, "startsOn" | "endsOn">): string {
  return schedule.endsOn ? `De ${dayText(schedule.startsOn)} a ${dayText(schedule.endsOn)}` : `A partir de ${dayText(schedule.startsOn)}`;
}

export function runText(run: ScheduleRun): string {
  if (run.outcome === "OPENED") return `${dayText(run.scheduledOn)}: aberta`;
  return `${dayText(run.scheduledOn)}: não aberta (${run.reason ? SKIP_REASON_LABELS[run.reason] : "motivo não informado"})`;
}

/** 5.3 item 3: the warning to whoever manages the schedule, shown here (SPEC 5.4, clarification of SF-184). */
export function scheduleWarning(schedule: Pick<ScheduleView, "status" | "consecutiveFailures" | "runs">): string | null {
  if (schedule.status === "paused" && schedule.consecutiveFailures >= FAILURES_TO_PAUSE) {
    return `Pausada pelo sistema: ${schedule.consecutiveFailures} execuções seguidas não abertas. Corrija a agenda e retome.`;
  }
  const latest = schedule.runs[0];
  if ((schedule.status === "active" || schedule.status === "paused") && latest?.outcome === "SKIPPED") {
    return "A última execução não abriu a solicitação.";
  }
  return null;
}

/** The saved values of a schedule, as the form's fields are named. */
function initialValues(schedule: ScheduleView): Record<string, string | string[]> {
  const answers = Object.fromEntries(Object.entries(schedule.answers).map(([id, value]) => [`field.${id}`, value]));
  return {
    ...answers,
    name: schedule.name,
    requesterId: schedule.requester.id,
    description: schedule.description,
    frequency: schedule.frequency,
    weekdays: schedule.weekdays.map(String),
    ...(schedule.monthDay !== null ? { monthDay: String(schedule.monthDay) } : {}),
    startsOn: schedule.startsOn,
    ...(schedule.endsOn ? { endsOn: schedule.endsOn } : {}),
  };
}

function StateButton({ action, area, label, scheduleId, secondary }: {
  action: (formData: FormData) => Promise<never>;
  area: string;
  label: string;
  scheduleId: string;
  secondary?: boolean;
}) {
  return (
    <form action={action}>
      <input name="area" type="hidden" value={area} />
      <input name="scheduleId" type="hidden" value={scheduleId} />
      <button className={secondary ? "button-secondary" : undefined} type="submit">
        {label}
      </button>
    </form>
  );
}

export function RecurringSchedules({ screen, area }: { screen: ScheduleScreen; area: "approvals" | "admin" }) {
  const { overview, form } = screen;
  const page = area === "admin" ? "/admin?section=recurring" : "/approvals/recurring";
  const link = (query: string) => `${page}${page.includes("?") ? "&" : "?"}${query}`;
  const feedback = scheduleMessage(screen.message);

  return (
    <section className="surface-card content-section" aria-labelledby="recurring-schedules-heading">
      <h2 id="recurring-schedules-heading">Agendas de recorrência</h2>
      <p className="section-description">
        Uma agenda abre, no dia previsto, uma solicitação em nome do solicitante, como se ele mesmo a abrisse. Dias em que a abertura
        não acontecer não são recuperados.
      </p>
      {feedback ? (
        <p className={`feedback${feedback.error ? " feedback-error" : ""}`} role={feedback.error ? "alert" : "status"}>
          {feedback.text}
        </p>
      ) : null}
      {screen.formUnavailable ? (
        <p className="feedback feedback-error" role="alert">
          Esta agenda não pode ser alterada agora: o serviço dela não pode mais ser agendado. Você pode pausá-la ou encerrá-la.
        </p>
      ) : null}

      {form ? (
        <section aria-labelledby="schedule-form-heading" className="schedule-form-section">
          <h3 id="schedule-form-heading">{form.editing ? `Alterar "${form.editing.name}"` : "Nova agenda"}</h3>
          <ScheduleForm
            action={form.editing ? updateScheduleAction : createScheduleAction}
            area={area}
            cancelHref={page}
            fieldErrors={form.fieldErrors}
            fields={form.fields}
            initial={form.editing ? initialValues(form.editing) : {}}
            requesters={overview.requesters}
            scheduleId={form.editing?.id ?? null}
            serviceId={form.serviceId}
            serviceName={form.serviceName}
            today={overview.today}
          />
        </section>
      ) : overview.services.length === 0 ? (
        <p>Nenhum serviço pode ser agendado agora: o serviço precisa estar ativo, no catálogo e sem documentos exigidos.</p>
      ) : (
        <form action={area === "admin" ? "/admin" : "/approvals/recurring"} aria-label="Escolher o serviço da nova agenda" className="create-form">
          {area === "admin" ? <input name="section" type="hidden" value="recurring" /> : null}
          <label>
            Serviço da nova agenda
            <select name="service" required>
              {overview.services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name} ({service.sectorName})
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Continuar</button>
        </form>
      )}

      {overview.schedules.length === 0 ? (
        <p>Nenhuma agenda cadastrada.</p>
      ) : (
        <table className="data-table">
          <caption>Agendas cadastradas</caption>
          <thead>
            <tr>
              <th scope="col">Agenda</th>
              <th scope="col">Serviço</th>
              <th scope="col">Solicitante</th>
              <th scope="col">Frequência</th>
              <th scope="col">Próxima abertura</th>
              <th scope="col">Estado</th>
              <th scope="col">Últimas execuções</th>
              <th scope="col">Ações</th>
            </tr>
          </thead>
          <tbody>
            {overview.schedules.map((schedule) => {
              const warning = scheduleWarning(schedule);
              return (
                <tr key={schedule.id}>
                  <td>
                    {schedule.name}
                    <br />
                    <span className="metadata">Criada por {schedule.createdBy.name}</span>
                  </td>
                  <td>
                    {schedule.service.name} ({schedule.service.sectorName})
                  </td>
                  <td>{schedule.requester.name}</td>
                  <td>
                    {frequencyText(schedule)}
                    <br />
                    <span className="metadata">{periodText(schedule)}</span>
                  </td>
                  <td>{schedule.nextOn ? dayText(schedule.nextOn) : "—"}</td>
                  <td>
                    {SCHEDULE_STATUS_LABELS[schedule.status]}
                    {warning ? (
                      <>
                        <br />
                        <strong className="field-error">{warning}</strong>
                      </>
                    ) : null}
                  </td>
                  <td>
                    {schedule.runs.length === 0 ? (
                      "Nenhuma ainda"
                    ) : (
                      <ul className="plain-list">
                        {schedule.runs.map((run) => (
                          <li key={run.scheduledOn}>{runText(run)}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td>
                    {schedule.actions.includes("edit") ? <Link href={link(`edit=${schedule.id}`)}>Alterar</Link> : null}
                    {schedule.actions.includes("pause") ? (
                      <StateButton action={pauseScheduleAction} area={area} label="Pausar" scheduleId={schedule.id} secondary />
                    ) : null}
                    {schedule.actions.includes("resume") ? (
                      <StateButton action={resumeScheduleAction} area={area} label="Retomar" scheduleId={schedule.id} />
                    ) : null}
                    {schedule.actions.includes("end") ? (
                      <StateButton action={endScheduleAction} area={area} label="Encerrar" scheduleId={schedule.id} secondary />
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="section-description">Encerrar é definitivo: a agenda deixa de abrir solicitações e fica só no histórico.</p>
    </section>
  );
}
