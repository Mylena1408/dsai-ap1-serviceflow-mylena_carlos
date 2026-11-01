import Link from "next/link";
import { notFound } from "next/navigation";
import {
  effectiveAssigneeId,
  getAttendantRequest,
  listRequestAttachments,
  listRequestFieldAnswers,
  listTransferCandidates,
} from "@/modules/requests";
import { RequestAttachments } from "@/app/_components/request-attachments";
import { RequestFieldAnswers } from "@/app/_components/request-field-answers";
import { NotFoundError } from "@/server/errors";
import { requireAttendantPageAccess } from "../../page-access";
import { addCommentAction, completeRequestAction, startRequestAction } from "../actions";
import { AssignmentPanel } from "./assignment-panel";
import { CancelRequestForm } from "./cancel-request-form";
import { RequestSla } from "@/app/_components/request-sla";
import { PriorityForm } from "./priority-form";
import { listComments } from "@/modules/comments";
import { RequestConversation } from "@/app/_components/request-conversation";
import { REQUEST_STATUS_LABELS } from "@/app/_components/request-status";
import { RequestTimeline } from "@/app/_components/request-timeline";

type QueueRequestPageProps = {
  params: Promise<{ requestId: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
};

const statusLabels = REQUEST_STATUS_LABELS;

function feedback(error?: string, notice?: string): string | null {
  if (error === "missing") return "A solicitação não está disponível no seu setor.";
  if (error === "state") return "O estado da solicitação mudou. Atualize a página e tente novamente.";
  if (error === "access") return "Sua sessão não permite esta operação.";
  if (error === "validation") return "Os dados enviados são inválidos.";
  if (error === "unexpected") return "Não foi possível concluir a operação.";
  if (notice === "started") return "Atendimento iniciado.";
  if (notice === "completed") return "Solicitação concluída.";
  if (notice === "assumed") return "Você assumiu esta solicitação.";
  if (notice === "released") return "Você liberou esta solicitação.";
  if (notice === "transferred") return "Solicitação transferida.";
  if (notice === "cancelled") return "Solicitação cancelada.";
  if (notice === "commented") return "Comentário enviado.";
  if (notice === "priority") return "Prioridade alterada.";
  if (error === "priority") return "Escolha uma prioridade diferente da atual.";
  if (error === "body") return "Escreva um comentário com até 5.000 caracteres.";
  if (error === "note") return "Informe a justificativa do cancelamento, com até 1.000 caracteres.";
  return null;
}

export default async function QueueRequestPage({
  params,
  searchParams,
}: QueueRequestPageProps) {
  const actor = await requireAttendantPageAccess();
  const [{ requestId }, { error, notice }] = await Promise.all([
    params,
    searchParams,
  ]);
  let request;
  let attachments;
  let answers;
  let comments;
  let candidates: Array<{ id: string; name: string }> = [];

  try {
    request = await getAttendantRequest(requestId);
    attachments = await listRequestAttachments(request.id);
    answers = await listRequestFieldAnswers(request.id);
    comments = await listComments(request.id);
    if (effectiveAssigneeId(request) === actor.id) {
      candidates = await listTransferCandidates(request.id);
    }
  } catch (caught) {
    if (caught instanceof NotFoundError) notFound();
    throw caught;
  }

  // Section 5.3: with an effective assignee only that attendant starts or completes.
  const assigneeId = effectiveAssigneeId(request);
  const heldByColleague = assigneeId !== null && assigneeId !== actor.id;

  return (
    <main className="page-shell">
      <header className="detail-heading">
      <nav aria-label="Navegação da fila">
        <Link href="/queue">Voltar à fila</Link>
      </nav>
      </header>
      {feedback(error, notice) ? (
        <p className={`feedback${error ? " feedback-error" : ""}`} role={error ? "alert" : "status"}>
          {feedback(error, notice)}
        </p>
      ) : null}
      <article className="surface-card">
        <p className="eyebrow">Atendimento da solicitação</p>
        <h1>{request.serviceNameSnapshot}</h1>
        <p><span className="status-pill">{statusLabels[request.status]}</span></p>
        <RequestSla request={request} now={new Date()} />
        <p>Categoria: {request.categoryNameSnapshot}</p>
        <p>Setor de origem: {request.sectorNameSnapshot}</p>
        <p>{request.serviceDescriptionSnapshot}</p>
        <h2>Descrição da solicitação</h2>
        <p className="request-description">{request.description}</p>
      </article>
      <AssignmentPanel request={request} actorId={actor.id} candidates={candidates} />
      {(request.status === "OPEN" || request.status === "IN_PROGRESS") && !heldByColleague ? (
        <>
          <PriorityForm requestId={request.id} priority={request.priority} />
          <CancelRequestForm requestId={request.id} />
        </>
      ) : null}
      {heldByColleague && (request.status === "OPEN" || request.status === "IN_PROGRESS") ? (
        <p className="content-section">
          Somente o responsável, {request.assignee?.name}, pode iniciar ou concluir esta solicitação.
        </p>
      ) : null}
      {request.status === "OPEN" && !heldByColleague ? (
        <form className="content-section" action={startRequestAction}>
          <input type="hidden" name="requestId" value={request.id} />
          <button type="submit">Iniciar atendimento</button>
        </form>
      ) : null}
      {request.status === "IN_PROGRESS" && !heldByColleague ? (
        <form className="content-section" action={completeRequestAction}>
          <input type="hidden" name="requestId" value={request.id} />
          <button type="submit">Concluir solicitação</button>
        </form>
      ) : null}
      <RequestFieldAnswers answers={answers} />
      <RequestAttachments requestId={request.id} attachments={attachments} />
      <RequestConversation
        requestId={request.id}
        comments={comments}
        canWrite={request.status !== "CANCELLED"}
        allowInternal
        action={addCommentAction}
      />
      <RequestTimeline request={request} actorLabel="Responsável pelo evento" />
    </main>
  );
}
