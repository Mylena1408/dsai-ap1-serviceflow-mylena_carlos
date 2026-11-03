"use client";

import { useState } from "react";
import { CustomFields, type OpeningField } from "@/app/(requester)/catalog/[serviceId]/request-form";
import { saveAttendanceFieldsAction } from "../actions";

// "Informações do atendimento" (SPEC 2026-11-03-campos-condicionais-atendimento, 5.4 and 5.5): the
// same inputs and conditions as the opening form. Required fields are demanded only at the
// completion, so the browser does not block a partial save.

type AttendanceFieldsFormProps = {
  requestId: string;
  fields: OpeningField[];
  /** Saved values by field id. */
  values: Record<string, string | string[]>;
};

export function AttendanceFieldsForm({ requestId, fields, values }: AttendanceFieldsFormProps) {
  const saved = Object.fromEntries(Object.entries(values).map(([id, value]) => [`field.${id}`, value]));
  const [current, setCurrent] = useState<Record<string, string | string[]>>(saved);

  function track(form: HTMLFormElement) {
    const next: Record<string, string | string[]> = {};
    for (const [name, value] of new FormData(form).entries()) {
      if (typeof value === "string" && name.startsWith("field.")) {
        const previous = next[name];
        next[name] = previous === undefined ? value : [...(Array.isArray(previous) ? previous : [previous]), value];
      }
    }
    setCurrent(next);
  }

  return (
    <section className="surface-card content-section" aria-labelledby="attendance-fields-heading">
      <p className="eyebrow">Atendimento</p>
      <h2 id="attendance-fields-heading">Informações do atendimento</h2>
      <p>
        Só a equipe do setor vê estas informações. Os campos marcados como obrigatórios precisam estar preenchidos para
        concluir a solicitação.
      </p>
      <form action={saveAttendanceFieldsAction} className="request-form" onChange={(event) => track(event.currentTarget)}>
        <input name="requestId" type="hidden" value={requestId} />
        <CustomFields
          current={current}
          fieldErrors={{}}
          fields={fields}
          legend="Campos do atendimento"
          requiredAttribute={false}
          values={saved}
        />
        <button type="submit">Salvar informações do atendimento</button>
      </form>
    </section>
  );
}
