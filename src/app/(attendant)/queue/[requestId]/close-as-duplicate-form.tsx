import Link from "next/link";
import { requestShortCode } from "@/shared/requests";
import { closeAsDuplicateAction } from "../actions";
import type { DuplicateOriginal } from "./duplicate-original";

// SPEC 2026-11-08-atendimento-dia-a-dia, 8.3 items 1 and 2 (SF-219): the attendant closes the duplicate with a
// mandatory note, as in the team's cancellation; the requester starts following the original.
export function CloseAsDuplicateForm({ requestId, original }: { requestId: string; original: DuplicateOriginal }) {
  const code = requestShortCode(original.id);
  return (
    <details className="surface-card content-section lifecycle-form">
      <summary>Encerrar como duplicada</summary>
      <p>
        Duplicada de{" "}
        {original.readable ? <Link href={`/queue/${original.id}`}>#{code}</Link> : <>#{code}</>} · {original.serviceName} ·
        Setor: {original.sectorName}
      </p>
      <p>
        Esta solicitação será cancelada com a justificativa &ldquo;Duplicada de #{code}&rdquo; e a sua nota; quem a abriu
        passa a acompanhar a original.
      </p>
      <form action={closeAsDuplicateAction}>
        <input type="hidden" name="requestId" value={requestId} />
        <label htmlFor="duplicate-note">Nota (obrigatória)</label>
        <textarea id="duplicate-note" name="note" required maxLength={1_000} rows={3} />
        <button className="button-danger" type="submit">Confirmar encerramento como duplicada</button>
      </form>
    </details>
  );
}
