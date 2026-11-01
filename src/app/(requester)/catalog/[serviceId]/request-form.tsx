"use client";

import { useState } from "react";
import { DocumentFields, type DocumentFieldRequirement } from "./document-fields";

// Opening form (SPEC 2026-09-30, section 7; SPEC 2026-11-01-campos-personalizados, 5.3). After
// a refused submission the server redirects back here; the typed text is kept in this
// component's state and restored, because it never travels in the address (5.3.4). Files
// cannot be restored by the browser and must be chosen again.

export type FieldErrorCode =
  | "required"
  | "too_long"
  | "line_break"
  | "not_integer"
  | "out_of_range"
  | "invalid_date"
  | "invalid_option"
  | "invalid_choice";

export interface OpeningField {
  id: string;
  label: string;
  helpText: string | null;
  type: "SHORT_TEXT" | "LONG_TEXT" | "INTEGER" | "DATE" | "SELECT" | "YES_NO";
  isRequired: boolean;
  options: string[];
  minValue: number | null;
  maxValue: number | null;
}

interface RequestFormProps {
  serviceId: string;
  fields: OpeningField[];
  fieldErrors: Record<string, FieldErrorCode>;
  requirements: DocumentFieldRequirement[];
  maxFileBytes: number;
  maxTotalBytes: number;
  action: (formData: FormData) => Promise<never>;
}

interface Draft {
  version: number;
  values: Record<string, string>;
}

const SHORT_TEXT_LIMIT = 200;
const LONG_TEXT_LIMIT = 2_000;
const FIRST_DATE = "1900-01-01";
const LAST_DATE = "2100-12-31";

function rangeMessage(field: OpeningField): string {
  if (field.type === "DATE") return "Informe uma data entre 01/01/1900 e 31/12/2100.";
  if (field.minValue !== null && field.maxValue !== null) {
    return `Informe um número de ${field.minValue} a ${field.maxValue}.`;
  }
  if (field.minValue !== null) return `Informe um número a partir de ${field.minValue}.`;
  if (field.maxValue !== null) return `Informe um número até ${field.maxValue}.`;
  return "Informe um número entre -1.000.000.000 e 1.000.000.000.";
}

export function fieldErrorMessage(field: OpeningField, code: FieldErrorCode): string {
  switch (code) {
    case "required":
      return "Preencha este campo.";
    case "too_long":
      return `Use no máximo ${field.type === "LONG_TEXT" ? "2.000" : SHORT_TEXT_LIMIT} caracteres.`;
    case "line_break":
      return "Use uma única linha.";
    case "not_integer":
      return "Informe um número inteiro, sem vírgula nem ponto.";
    case "out_of_range":
      return rangeMessage(field);
    case "invalid_date":
      return "Informe uma data válida.";
    case "invalid_option":
      return "Escolha uma das opções da lista.";
    case "invalid_choice":
      return "Escolha Sim ou Não.";
  }
}

function FieldInput({ field, value, invalid, describedBy }: {
  field: OpeningField;
  value: string | undefined;
  invalid: boolean;
  describedBy: string | undefined;
}) {
  const common = {
    id: `field-${field.id}`,
    name: `field.${field.id}`,
    required: field.isRequired,
    defaultValue: value,
    "aria-invalid": invalid || undefined,
    "aria-describedby": describedBy,
  };

  switch (field.type) {
    case "SHORT_TEXT":
      return <input {...common} maxLength={SHORT_TEXT_LIMIT} />;
    case "LONG_TEXT":
      return <textarea {...common} maxLength={LONG_TEXT_LIMIT} rows={4} />;
    case "INTEGER":
      return (
        <input
          {...common}
          inputMode="numeric"
          max={field.maxValue ?? undefined}
          min={field.minValue ?? undefined}
          step={1}
          type="number"
        />
      );
    case "DATE":
      return <input {...common} max={LAST_DATE} min={FIRST_DATE} type="date" />;
    case "SELECT":
      return (
        <select {...common} defaultValue={value ?? ""}>
          <option value="">Selecione</option>
          {field.options.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      );
    case "YES_NO":
      return (
        <select {...common} defaultValue={value ?? ""}>
          <option value="">Selecione</option>
          <option value="true">Sim</option>
          <option value="false">Não</option>
        </select>
      );
  }
}

function CustomFields({ fields, fieldErrors, values }: {
  fields: OpeningField[];
  fieldErrors: Record<string, FieldErrorCode>;
  values: Record<string, string>;
}) {
  return (
    <fieldset className="custom-fields">
      <legend>Informações do serviço</legend>
      {fields.map((field) => {
        const code = fieldErrors[field.id];
        const helpId = field.helpText ? `field-${field.id}-help` : undefined;
        const errorId = code ? `field-${field.id}-error` : undefined;
        const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;

        return (
          <div className="custom-field" key={field.id}>
            <label htmlFor={`field-${field.id}`}>
              {field.label} {field.isRequired ? "(obrigatório)" : "(opcional)"}
            </label>
            <FieldInput
              describedBy={describedBy}
              field={field}
              invalid={Boolean(code)}
              value={values[`field.${field.id}`]}
            />
            {field.helpText ? <p className="field-help" id={helpId}>{field.helpText}</p> : null}
            {code ? <p className="field-error" id={errorId}>{fieldErrorMessage(field, code)}</p> : null}
          </div>
        );
      })}
    </fieldset>
  );
}

export function RequestForm({
  serviceId,
  fields,
  fieldErrors,
  requirements,
  maxFileBytes,
  maxTotalBytes,
  action,
}: RequestFormProps) {
  const [draft, setDraft] = useState<Draft>({ version: 0, values: {} });

  // The draft is saved before sending; a new key remounts the form with it as default values,
  // so they survive both React's form reset and the redirect back with the errors.
  async function submit(formData: FormData) {
    const values: Record<string, string> = {};
    for (const [name, value] of formData.entries()) {
      if (typeof value === "string" && (name === "description" || name.startsWith("field."))) {
        values[name] = value;
      }
    }
    setDraft((current) => ({ version: current.version + 1, values }));
    await action(formData);
  }

  return (
    <form action={submit} className="request-form" key={draft.version}>
      <input type="hidden" name="serviceId" value={serviceId} />
      <label htmlFor="request-description">Descreva o que você precisa</label>
      <textarea
        id="request-description"
        name="description"
        required
        maxLength={10_000}
        rows={6}
        defaultValue={draft.values.description}
      />
      <p>Máximo de 10.000 caracteres.</p>
      {fields.length > 0 ? (
        <CustomFields fieldErrors={fieldErrors} fields={fields} values={draft.values} />
      ) : null}
      {requirements.length > 0 ? (
        <DocumentFields
          requirements={requirements}
          maxFileBytes={maxFileBytes}
          maxTotalBytes={maxTotalBytes}
        />
      ) : null}
      <button type="submit">Enviar solicitação</button>
    </form>
  );
}
