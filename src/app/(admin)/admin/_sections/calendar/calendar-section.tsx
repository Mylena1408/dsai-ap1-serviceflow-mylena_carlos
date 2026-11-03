import { MAX_HOLIDAY_NAME_LENGTH, WEEKDAY_LABELS, timeOfMinute, type CalendarOverview } from "@/modules/calendar";
import { createHolidayAction, deleteHolidayAction, updateCalendarAction } from "./actions";

// "Calendário" (SPEC 2026-11-03-pausa-sla-calendario, 5.1 and 5.7): the business days, the daily
// window and the time zone used by services that count the SLA in business hours, and the holidays.

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

function holidayDate(day: string, yearly: boolean): string {
  const [year, month, date] = day.split("-");
  return yearly ? `${date}/${month} (todo ano)` : `${date}/${month}/${year}`;
}

export function CalendarSection({ overview }: { overview: CalendarOverview }) {
  const { settings, holidays } = overview;

  return (
    <section className="admin-section" aria-labelledby="calendar-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Prazos</p>
          <h2 id="calendar-heading">Calendário</h2>
          <p className="section-description">
            Dias e horário de expediente da organização. Os serviços com &quot;Contagem do prazo&quot; em horas úteis só contam o
            tempo dentro desse horário, fora dos feriados. Mudanças valem para os próximos cálculos: vencimentos já
            calculados não mudam.
          </p>
        </div>
      </div>

      <form action={updateCalendarAction} aria-label="Expediente" className="create-form">
        <fieldset className="format-options">
          <legend>Dias de expediente</legend>
          {WEEKDAYS.map((day) => (
            <label className="checkbox-field" key={day}>
              <input defaultChecked={settings.weekdays.includes(day)} name="weekdays" type="checkbox" value={String(day)} />
              {WEEKDAY_LABELS[day]}
            </label>
          ))}
        </fieldset>
        <label>
          Início do expediente
          <input defaultValue={timeOfMinute(settings.startMinute)} name="startTime" pattern="[0-2][0-9]:[0-5][0-9]" required type="text" />
        </label>
        <label>
          Fim do expediente
          <input defaultValue={timeOfMinute(settings.endMinute)} name="endTime" pattern="[0-2][0-9]:[0-5][0-9]" required type="text" />
        </label>
        <label>
          Fuso horário
          <input defaultValue={settings.timeZone} maxLength={100} name="timeZone" required type="text" />
        </label>
        <p className="section-description">
          Horários no formato HH:MM (24:00 é o fim do dia). Fuso no formato IANA, por exemplo America/Sao_Paulo ou America/Belem.
        </p>
        <button type="submit">Salvar expediente</button>
      </form>

      <h3>Feriados</h3>
      <form action={createHolidayAction} aria-label="Novo feriado" className="create-form">
        <label>
          Data
          <input name="day" required type="date" />
        </label>
        <label>
          Nome
          <input maxLength={MAX_HOLIDAY_NAME_LENGTH} name="name" required type="text" />
        </label>
        <label className="checkbox-field">
          <input name="yearly" type="checkbox" />
          Repete todo ano
        </label>
        <button type="submit">Cadastrar feriado</button>
      </form>

      {holidays.length === 0 ? (
        <p className="empty-state">Nenhum feriado cadastrado.</p>
      ) : (
        <ul className="entity-list" aria-label="Feriados cadastrados">
          {holidays.map((holiday) => (
            <li className="entity-item" key={holiday.id}>
              <div className="entity-record-content">
                <div className="entity-summary">
                  <strong>{holiday.name}</strong>
                </div>
                <div className="entity-details">
                  <span>{holidayDate(holiday.day, holiday.yearly)}</span>
                </div>
              </div>
              <form action={deleteHolidayAction} className="entity-actions">
                <input name="holidayId" type="hidden" value={holiday.id} />
                <button aria-label={`Remover ${holiday.name}`} className="button-danger" type="submit">
                  Remover
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
