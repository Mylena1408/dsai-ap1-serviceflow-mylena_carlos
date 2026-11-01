import Link from "next/link";
import { notFound } from "next/navigation";
import { getManagerRequest, listRequestAttachments, listRequestFieldAnswers } from "@/modules/requests";
import { NotFoundError } from "@/server/errors";
import { RequestApprovalLabel } from "@/app/_components/request-approval";
import { RequestAttachments } from "@/app/_components/request-attachments";
import { RequestFieldAnswers } from "@/app/_components/request-field-answers";
import { RequestSla } from "@/app/_components/request-sla";
import { REQUEST_STATUS_LABELS } from "@/app/_components/request-status";
import { RequestTimeline } from "@/app/_components/request-timeline";
import { requireManagerPageAccess } from "../../page-access";
import { approveRequestAction, rejectRequestAction } from "../actions";

type ApprovalPageProps = {
  params: Promise<{ requestId: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
};

function feedback(error?: string, notice?: string): string | null {
  if (notice === "approved") return "Solicitação aprovada.";
  if (notice === "rejected") return "Solicitação rejeitada.";
  if (error === "note") return "Informe a observação da rejeição, com até 1.000 caracteres.";
  if (error === "decided") return "Esta solicitação já foi decidida ou não está mais aberta.";
  if (error === "missing") return "A solicitação não está disponível para o seu setor.";
  if (error === "validation") return "Os dados enviados são inválidos.";
  if (error === "unexpected") return "Não foi possível concluir a operação.";
  return null;
}

// Read-only detail with the decision forms (SPEC 2026-11-01-aprovacoes, 5.4 and 5.7).
export default async function ApprovalPage({ params, searchParams }: ApprovalPageProps) {
  await requireManagerPageAccess();
  const [{ requestId }, { error, notice }] = await Promise.all([params, searchParams]);
  let request;
  let attachments;
  let answers;

  try {
    request = await getManagerRequest(requestId);
    attachments = await listRequestAttachments(request.id);
    answers = await listRequestFieldAnswers(request.id);
  } catch (caught) {
    if (caught instanceof NotFoundError) notFound();
    throw caught;
  }

  const message = feedback(error, notice);
  const pending = request.approvalState === "PENDING" && request.status === "OPEN";

  return (
    <main className="page-shell">
      <header className="detail-heading">
        <nav aria-label="Navegação das aprovações">
          <Link href="/approvals">Voltar às aprovações</Link>
        </nav>
      </header>
      {message ? (
        <p className={`feedback${error ? " feedback-error" : ""}`} role={error ? "alert" : "status"}>
          {message}
        </p>
      ) : null}
      <article className="surface-card">
        <p className="eyebrow">Solicitação para aprovação</p>
        <h1>{request.serviceNameSnapshot}</h1>
        <p>
          <span className="status-pill">{REQUEST_STATUS_LABELS[request.status]}</span>{" "}
          <RequestApprovalLabel request={request} />
        </p>
        <RequestSla request={request} now={new Date()} />
        <p>Categoria: {request.categoryNameSnapshot}</p>
        <p>Setor: {request.sectorNameSnapshot}</p>
        <h2>Descrição da solicitação</h2>
        <p className="request-description">{request.description}</p>
      </article>
      {pending ? (
        <section className="surface-card content-section" aria-labelledby="decision-heading">
          <p className="eyebrow">Decisão</p>
          <h2 id="decision-heading">Aprovar ou rejeitar</h2>
          <form action={approveRequestAction} className="lifecycle-form">
            <input type="hidden" name="requestId" value={request.id} />
            <label htmlFor="approve-note">Observação (opcional)</label>
            <textarea id="approve-note" name="note" maxLength={1_000} rows={2} />
            <button type="submit">Aprovar</button>
          </form>
          <details className="lifecycle-form">
            <summary>Rejeitar</summary>
            <form action={rejectRequestAction}>
              <input type="hidden" name="requestId" value={request.id} />
              <label htmlFor="reject-note">Observação (obrigatória)</label>
              <textarea id="reject-note" name="note" required maxLength={1_000} rows={3} />
              <p>A rejeição cancela a solicitação.</p>
              <button className="button-danger" type="submit">Confirmar rejeição</button>
            </form>
          </details>
        </section>
      ) : null}
      <RequestFieldAnswers answers={answers} />
      <RequestAttachments requestId={request.id} attachments={attachments} />
      <RequestTimeline request={request} actorLabel="Responsável pelo evento" />
    </main>
  );
}
