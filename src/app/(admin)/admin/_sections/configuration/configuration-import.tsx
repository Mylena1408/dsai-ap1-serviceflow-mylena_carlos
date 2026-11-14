"use client";

import { useActionState } from "react";
import type { ImportPreview, ItemKind, ItemStatus } from "@/modules/configuration";
import { applyImportAction, previewImportAction, type ImportState } from "./actions";

// The import from the administration (SPEC 2026-11-07-operacao-e-automacao, 6.3 items 4 and 5; decision H12):
// the file first goes to the preview; only an accepted preview offers "Aplicar", which sends the same file.
// A new preview starts the confirmation again.

const KIND_LABELS: Record<ItemKind, string> = {
  sector: "Setor",
  escalationRule: "Regra de escalonamento",
  cannedResponse: "Resposta pronta",
  tag: "Etiqueta",
  category: "Categoria",
  service: "Serviço",
  field: "Campo",
  document: "Documento exigido",
  stage: "Etapa",
  article: "Artigo",
  checklistItem: "Item de checklist",
  accessRole: "Papel",
  calendar: "Calendário",
  holiday: "Feriado",
  bundle: "Pacote",
};

const STATUS_LABELS: Record<ItemStatus, string> = { new: "Novo", changed: "Alterado", equal: "Igual" };

/** The file's field names, as the screens call them. */
const FIELD_LABELS: Record<string, string> = {
  name: "nome",
  title: "título",
  label: "rótulo",
  description: "descrição",
  body: "texto",
  isActive: "ativo",
  isRequired: "obrigatório",
  isPublished: "publicado",
  position: "posição",
  category: "categoria",
  sector: "setor",
  type: "tipo",
  audience: "quem preenche",
  helpText: "ajuda",
  options: "opções",
  condition: "condição",
  assignee: "responsável",
  assignTo: "atribuir a",
  notify: "avisar",
  targetDays: "dias de meta",
  slaHours: "prazo em horas",
  slaBusinessHours: "horário de expediente",
  defaultPriority: "prioridade padrão",
  requiresApproval: "exige aprovação",
  approvalSectors: "setores de aprovação",
  approvalCondition: "condição da aprovação",
  approvalDeadlineDays: "prazo da aprovação",
  distributionMode: "distribuição",
  maxActivePerAttendant: "limite por atendente",
  redistributeOnAbsence: "passar na ausência",
  escalateOverdue: "escalar vencidas",
  permissions: "permissões",
  services: "serviços",
  acceptedFormats: "formatos",
  weekdays: "dias",
  startTime: "início",
  endTime: "fim",
  timeZone: "fuso",
  yearly: "todo ano",
  color: "cor",
  text: "texto",
};

const count = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;

function Summary({ summary }: { summary: Record<ItemStatus, number> }) {
  return (
    <p>
      {count(summary.new, "item novo", "itens novos")}, {count(summary.changed, "alterado", "alterados")} e {count(summary.equal, "igual", "iguais")}.
    </p>
  );
}

function ApplyForm({ preview, content }: { preview: ImportPreview; content: string }) {
  const [state, apply, applying] = useActionState<ImportState, FormData>(applyImportAction, { step: "idle" });

  if (state.step === "applied") {
    return (
      <div className="feedback" role="status">
        <p>Importação aplicada.</p>
        <Summary summary={state.summary} />
      </div>
    );
  }

  return (
    <form action={apply} aria-label="Aplicar a importação">
      <input name="content" type="hidden" value={content} />
      <input name="digest" type="hidden" value={preview.digest} />
      <input name="destinationDigest" type="hidden" value={preview.destinationDigest} />
      {state.step === "error" ? (
        <p className="feedback feedback-error" role="alert">
          {state.message}
        </p>
      ) : null}
      <p className="section-description">
        Ao aplicar, os itens novos são criados e os alterados atualizados, tudo de uma vez; nada é apagado e o que não está no arquivo fica como está.
      </p>
      <button disabled={applying || preview.summary.new + preview.summary.changed === 0} type="submit">
        {applying ? "Aplicando…" : "Aplicar a importação"}
      </button>
    </form>
  );
}

function PreviewResult({ preview, content, fileName }: { preview: ImportPreview; content: string; fileName: string }) {
  const changing = preview.items.filter((item) => item.status !== "equal");

  return (
    <section aria-labelledby="configuration-preview-heading" className="configuration-preview">
      <h3 id="configuration-preview-heading">Prévia de {fileName}</h3>
      {!preview.accepted ? (
        <div className="feedback feedback-error" role="alert">
          <p>
            O arquivo foi recusado
            {preview.problemCount > preview.problems.length ? ` (${preview.problemCount} problemas; os ${preview.problems.length} primeiros abaixo)` : ""}. Nada foi
            gravado.
          </p>
          <ul aria-label="Problemas do arquivo">
            {preview.problems.map((problem, index) => (
              <li key={index}>
                <code>{problem.path}</code>: {problem.message}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <Summary summary={preview.summary} />
          {preview.warnings.length > 0 ? (
            <div className="feedback" role="note">
              <p>Avisos:</p>
              <ul aria-label="Avisos da importação">
                {preview.warnings.map((warning, index) => (
                  <li key={index}>
                    <code>{warning.path}</code>: {warning.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {changing.length > 0 ? (
            <table className="data-table">
              <caption>Itens novos e alterados</caption>
              <thead>
                <tr>
                  <th scope="col">Tipo</th>
                  <th scope="col">Item</th>
                  <th scope="col">Situação</th>
                  <th scope="col">O que muda</th>
                </tr>
              </thead>
              <tbody>
                {changing.map((item) => (
                  <tr key={`${item.kind}:${item.label}`}>
                    <td>{KIND_LABELS[item.kind]}</td>
                    <td>{item.label}</td>
                    <td>{STATUS_LABELS[item.status]}</td>
                    <td>{item.changes.map((change) => FIELD_LABELS[change] ?? change).join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>Tudo no arquivo já está igual neste ambiente: não há o que aplicar.</p>
          )}
          <ApplyForm content={content} key={`${preview.digest}:${preview.destinationDigest}`} preview={preview} />
        </>
      )}
    </section>
  );
}

export function ConfigurationImport() {
  const [state, sendForPreview, previewing] = useActionState<ImportState, FormData>(previewImportAction, { step: "idle" });

  return (
    <div>
      <form action={sendForPreview} aria-label="Enviar arquivo para a prévia" className="create-form">
        <label>
          Arquivo de configuração (JSON, até 2 MB)
          <input accept="application/json,.json" name="file" required type="file" />
        </label>
        <button disabled={previewing} type="submit">
          {previewing ? "Conferindo…" : "Ver prévia"}
        </button>
      </form>
      {state.step === "error" ? (
        <p className="feedback feedback-error" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.step === "preview" ? <PreviewResult content={state.content} fileName={state.fileName} preview={state.preview} /> : null}
    </div>
  );
}
