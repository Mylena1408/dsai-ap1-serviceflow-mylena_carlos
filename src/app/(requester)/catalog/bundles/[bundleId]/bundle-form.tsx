"use client";

import { useState } from "react";
import { CustomFields, type FieldErrorCode, type OpeningField } from "../../[serviceId]/request-form";

// Opening form of a bundle (SPEC 2026-11-07-operacao-e-automacao, 3.3 item 3): one description for
// every request and one section per service, with that service's fields. As in the opening of a
// service, the typed values are kept in this component and restored after a refused submission
// (SPEC 2026-11-06-formularios-mantem-dados); they never travel in the address.

export interface BundleSection {
  serviceId: string;
  serviceName: string;
  sectorName: string;
  fields: OpeningField[];
}

interface BundleFormProps {
  bundleId: string;
  sections: BundleSection[];
  fieldErrors: Record<string, FieldErrorCode>;
  action: (formData: FormData) => Promise<never>;
}

function collect(entries: Iterable<[string, FormDataEntryValue]>, keep: (name: string) => boolean): Record<string, string | string[]> {
  const values: Record<string, string | string[]> = {};
  for (const [name, value] of entries) {
    if (typeof value !== "string" || !keep(name)) continue;
    // Several boxes of a multiple choice share the name.
    const previous = values[name];
    values[name] = previous === undefined ? value : [...(Array.isArray(previous) ? previous : [previous]), value];
  }
  return values;
}

export function BundleForm({ bundleId, sections, fieldErrors, action }: BundleFormProps) {
  const [draft, setDraft] = useState<{ version: number; values: Record<string, string | string[]> }>({ version: 0, values: {} });
  const [current, setCurrent] = useState<Record<string, string | string[]>>({});

  async function submit(formData: FormData) {
    setDraft((previous) => ({
      version: previous.version + 1,
      values: collect(formData.entries(), (name) => name === "description" || name.startsWith("field.")),
    }));
    await action(formData);
  }

  return (
    <form
      action={submit}
      className="request-form bundle-opening-form"
      key={draft.version}
      onChange={(event) => setCurrent(collect(new FormData(event.currentTarget).entries(), (name) => name.startsWith("field.")))}
    >
      <input type="hidden" name="bundleId" value={bundleId} />
      <label htmlFor="bundle-description">Descreva o que você precisa</label>
      <textarea
        id="bundle-description"
        name="description"
        required
        maxLength={10_000}
        rows={5}
        defaultValue={draft.values.description as string | undefined}
      />
      <p>A descrição vale para todas as solicitações do pacote. Máximo de 10.000 caracteres.</p>
      {sections.map((section, index) => (
        <section aria-label={`${index + 1}. ${section.serviceName}`} className="bundle-section" key={section.serviceId}>
          <h3>
            {index + 1}. {section.serviceName}
          </h3>
          <p className="metadata">Atendido por: {section.sectorName}</p>
          {section.fields.length > 0 ? (
            <CustomFields
              current={{ ...draft.values, ...current }}
              fieldErrors={fieldErrors}
              fields={section.fields}
              legend={`Informações de ${section.serviceName}`}
              values={draft.values}
            />
          ) : (
            <p className="section-description">Este serviço não pede informações adicionais.</p>
          )}
        </section>
      ))}
      <button type="submit">Enviar pacote</button>
    </form>
  );
}
