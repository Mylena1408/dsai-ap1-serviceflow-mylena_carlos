import { addLateDocumentAction } from "../actions";

type LateDocumentFormProps = {
  requestId: string;
  requirements: Array<{ id: string; name: string; isRequired: boolean; acceptedFormats: readonly string[] }>;
};

// "Enviar documento que falta" (SPEC 2026-11-03-anexos-comentarios-documentos, 5.3). The list only
// mirrors the rules; the server checks the requirement, the format and the limits again.
export function LateDocumentForm({ requestId, requirements }: LateDocumentFormProps) {
  return (
    <section className="surface-card content-section" aria-labelledby="late-document-heading">
      <p className="eyebrow">Documentos</p>
      <h2 id="late-document-heading">Enviar documento que falta</h2>
      <form action={addLateDocumentAction} className="create-form">
        <input type="hidden" name="requestId" value={requestId} />
        <label htmlFor="late-document-requirement">Documento</label>
        <select id="late-document-requirement" name="requirementId" required defaultValue="">
          <option value="" disabled>
            Escolha o documento
          </option>
          {requirements.map((requirement) => (
            <option key={requirement.id} value={requirement.id}>
              {requirement.name} ({requirement.isRequired ? "obrigatório" : "opcional"}; {requirement.acceptedFormats.join(", ")})
            </option>
          ))}
        </select>
        <label htmlFor="late-document-file">Arquivo</label>
        <input id="late-document-file" name="file" type="file" required accept=".pdf,.docx,.txt" />
        <p className="metadata">Até 2 MiB, no formato aceito pelo documento escolhido.</p>
        <button type="submit">Enviar documento</button>
      </form>
    </section>
  );
}
