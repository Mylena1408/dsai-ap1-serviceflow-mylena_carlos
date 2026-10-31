"use client";

import { useState, type ChangeEvent } from "react";

export interface DocumentFieldRequirement {
  id: string;
  name: string;
  isRequired: boolean;
  acceptedFormats: Array<"PDF" | "DOCX" | "TXT">;
}

interface DocumentFieldsProps {
  requirements: DocumentFieldRequirement[];
  maxFileBytes: number;
  maxTotalBytes: number;
}

const EXTENSIONS = { PDF: ".pdf", DOCX: ".docx", TXT: ".txt" } as const;

function formatMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toLocaleString("pt-BR")} MiB`;
}

// Mirrors the size limits before sending, because the Server Action body limit rejects an
// oversized form before the server validation can answer (SPEC 21.15.3). The server
// remains the source of truth for every rule.
export function DocumentFields({ requirements, maxFileBytes, maxTotalBytes }: DocumentFieldsProps) {
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const total = Object.values(sizes).reduce((sum, size) => sum + size, 0);
  const tooBig = Object.values(sizes).some((size) => size > maxFileBytes);
  const message = tooBig
    ? `Cada arquivo pode ter no máximo ${formatMiB(maxFileBytes)}.`
    : total > maxTotalBytes
      ? `Os arquivos juntos podem ter no máximo ${formatMiB(maxTotalBytes)}.`
      : null;

  function onChange(requirementId: string, event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const size = input.files?.[0]?.size ?? 0;
    const next = { ...sizes, [requirementId]: size };
    const nextTotal = Object.values(next).reduce((sum, value) => sum + value, 0);

    input.setCustomValidity(
      size > maxFileBytes || nextTotal > maxTotalBytes ? "Arquivo acima do limite." : "",
    );
    setSizes(next);
  }

  return (
    <fieldset className="document-fields">
      <legend>Documentos solicitados</legend>
      <p>
        Um arquivo por documento, com até {formatMiB(maxFileBytes)} cada e{" "}
        {formatMiB(maxTotalBytes)} no total.
      </p>
      {requirements.map((requirement) => {
        const inputId = `document-${requirement.id}`;

        return (
          <div className="document-field" key={requirement.id}>
            <label htmlFor={inputId}>
              {requirement.name} ({requirement.isRequired ? "obrigatório" : "opcional"})
            </label>
            <input
              id={inputId}
              type="file"
              name={`attachment:${requirement.id}`}
              required={requirement.isRequired}
              accept={requirement.acceptedFormats.map((format) => EXTENSIONS[format]).join(",")}
              onChange={(event) => onChange(requirement.id, event)}
            />
            <p>Formatos aceitos: {requirement.acceptedFormats.join(", ")}</p>
          </div>
        );
      })}
      {message ? (
        <p className="feedback feedback-error" role="alert">
          {message}
        </p>
      ) : null}
    </fieldset>
  );
}
