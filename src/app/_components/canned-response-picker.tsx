"use client";

import { useState } from "react";
import { appendToComment } from "@/shared/comments";

// "Inserir resposta pronta" (SPEC 2026-11-06-respostas-prontas, 4.4): appends the chosen text,
// with its fields already replaced on the server, to the comment field. It never sends anything.

export interface PickerResponse {
  id: string;
  title: string;
  text: string;
}

export function CannedResponsePicker({ responses, targetId }: { responses: readonly PickerResponse[]; targetId: string }) {
  const [chosen, setChosen] = useState("");

  if (responses.length === 0) return null;

  function insert() {
    const response = responses.find((item) => item.id === chosen);
    const field = document.getElementById(targetId);
    if (!response || !(field instanceof HTMLTextAreaElement)) return;
    field.value = appendToComment(field.value, response.text).slice(0, field.maxLength > 0 ? field.maxLength : undefined);
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }

  return (
    <div className="canned-picker">
      <label htmlFor="canned-response">Inserir resposta pronta</label>
      <div className="canned-picker-row">
        <select id="canned-response" value={chosen} onChange={(event) => setChosen(event.target.value)}>
          <option value="">Escolha uma resposta</option>
          {responses.map((response) => (
            <option key={response.id} value={response.id}>
              {response.title}
            </option>
          ))}
        </select>
        <button className="button-secondary" type="button" onClick={insert} disabled={chosen === ""}>
          Inserir
        </button>
      </div>
    </div>
  );
}
