"use client";

import Link from "next/link";
import { useState } from "react";
import { CustomFields, type FieldErrorCode, type OpeningField } from "@/app/(requester)/catalog/[serviceId]/request-form";

// Form of a schedule (SPEC 2026-11-07-operacao-e-automacao, 5.3 item 2): the requester, the description
// and the service's fields as the opening asks them, and the frequency. As in the opening, what was typed
// is kept in this component and restored after a refused submission; it never travels in the address.

type Values = Record<string, string | string[]>;

const WEEKDAYS: Array<[string, string]> = [
  ["1", "Segunda"],
  ["2", "Terça"],
  ["3", "Quarta"],
  ["4", "Quinta"],
  ["5", "Sexta"],
  ["6", "Sábado"],
  ["7", "Domingo"],
];

function collect(entries: Iterable<[string, FormDataEntryValue]>, keep: (name: string) => boolean): Values {
  const values: Values = {};
  for (const [name, value] of entries) {
    if (typeof value !== "string" || !keep(name)) continue;
    const previous = values[name];
    values[name] = previous === undefined ? value : [...(Array.isArray(previous) ? previous : [previous]), value];
  }
  return values;
}

const asText = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);
const asList = (value: string | string[] | undefined) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

export interface ScheduleFormProps {
  action: (formData: FormData) => Promise<never>;
  area: "approvals" | "admin";
  serviceId: string;
  serviceName: string;
  scheduleId: string | null;
  requesters: Array<{ id: string; name: string }>;
  fields: OpeningField[];
  fieldErrors: Record<string, FieldErrorCode>;
  today: string;
  /** The saved values of a schedule being changed, with the answers as "field.<id>". */
  initial: Values;
  cancelHref: string;
}

export function ScheduleForm({ action, area, serviceId, serviceName, scheduleId, requesters, fields, fieldErrors, today, initial, cancelHref }: ScheduleFormProps) {
  const [draft, setDraft] = useState<{ version: number; values: Values }>({ version: 0, values: initial });
  const [current, setCurrent] = useState<Values>({});
  const values = draft.values;

  async function submit(formData: FormData) {
    setDraft((previous) => ({ version: previous.version + 1, values: collect(formData.entries(), (name) => name !== "area" && name !== "scheduleId") }));
    await action(formData);
  }

  return (
    <form
      action={submit}
      aria-label={scheduleId ? "Alterar agenda" : "Nova agenda"}
      className="request-form schedule-form"
      key={draft.version}
      onChange={(event) => setCurrent(collect(new FormData(event.currentTarget).entries(), (name) => name.startsWith("field.")))}
    >
      <input name="area" type="hidden" value={area} />
      <input name="serviceId" type="hidden" value={serviceId} />
      {scheduleId ? <input name="scheduleId" type="hidden" value={scheduleId} /> : null}
      <p className="metadata">Serviço: {serviceName}</p>
      <label>
        Nome da agenda
        <input defaultValue={asText(values.name)} maxLength={80} name="name" required />
      </label>
      <label>
        Solicitante
        <select defaultValue={asText(values.requesterId)} name="requesterId" required>
          <option value="">Escolha o solicitante</option>
          {requesters.map((requester) => (
            <option key={requester.id} value={requester.id}>
              {requester.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Descrição de cada solicitação
        <textarea defaultValue={asText(values.description)} maxLength={10_000} name="description" required rows={4} />
      </label>
      {fields.length > 0 ? (
        <CustomFields current={{ ...values, ...current }} fieldErrors={fieldErrors} fields={fields} legend={`Informações de ${serviceName}`} values={values} />
      ) : (
        <p className="section-description">Este serviço não pede informações adicionais.</p>
      )}
      <fieldset>
        <legend>Frequência</legend>
        <label>
          <input defaultChecked={asText(values.frequency) !== "MONTHLY"} name="frequency" type="radio" value="WEEKLY" /> Semanal, nos dias marcados
        </label>
        <div className="checkbox-group" role="group" aria-label="Dias da semana">
          {WEEKDAYS.map(([value, label]) => (
            <label key={value}>
              <input defaultChecked={asList(values.weekdays).includes(value)} name="weekdays" type="checkbox" value={value} /> {label}
            </label>
          ))}
        </div>
        <label>
          <input defaultChecked={asText(values.frequency) === "MONTHLY"} name="frequency" type="radio" value="MONTHLY" /> Mensal, no dia
        </label>
        <label>
          Dia do mês (1 a 28)
          <input defaultValue={asText(values.monthDay)} max={28} min={1} name="monthDay" type="number" />
        </label>
      </fieldset>
      <label>
        Início
        <input defaultValue={asText(values.startsOn)} min={scheduleId ? undefined : today} name="startsOn" required type="date" />
      </label>
      <label>
        Fim (opcional, até 2 anos depois do início)
        <input defaultValue={asText(values.endsOn)} name="endsOn" type="date" />
      </label>
      <div className="form-actions">
        <button type="submit">{scheduleId ? "Salvar alterações" : "Criar agenda"}</button>
        <Link href={cancelHref}>Cancelar</Link>
      </div>
    </form>
  );
}
