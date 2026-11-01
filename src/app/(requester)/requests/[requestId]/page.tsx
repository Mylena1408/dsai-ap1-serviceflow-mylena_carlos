import Link from "next/link";
import { notFound } from "next/navigation";
import {
  effectiveAssigneeId,
  getRequesterRequest,
  listRequestAttachments,
  listRequestFieldAnswers,
} from "@/modules/requests";
import { RequestAttachments } from "@/app/_components/request-attachments";
import { RequestFieldAnswers } from "@/app/_components/request-field-answers";
import { RequestStageLabel, RequestStageSteps } from "@/app/_components/request-stage";
import { NotFoundError } from "@/server/errors";
import { requireRequesterPageAccess } from "../../page-access";
import { REQUEST_STATUS_LABELS } from "@/app/_components/request-status";
import { RequestSla } from "@/app/_components/request-sla";
import { RequestTimeline } from "@/app/_components/request-timeline";
import { LifecyclePanel } from "./lifecycle-panel";
import { listComments } from "@/modules/comments";
import { RequestConversation } from "@/app/_components/request-conversation";
import { addOwnCommentAction } from "../actions";

type RequestPageProps = {
  params: Promise<{ requestId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
};

const statusLabels = REQUEST_STATUS_LABELS;

function feedback(notice?: string, error?: string): string | null {
  if (notice === "created") return "Sua solicitação foi aberta.";
  if (notice === "cancelled") return "Sua solicitação foi cancelada.";
  if (notice === "reopened") return "Sua solicitação foi reaberta.";
  if (notice === "commented") return "Comentário enviado.";
  if (error === "body") return "Escreva um comentário com até 5.000 caracteres.";
  if (error === "note") return "Informe o motivo com até 1.000 caracteres (obrigatório para reabrir).";
  if (error === "state") {
    return "Não é possível fazer isso agora: a solicitação mudou de estado ou o prazo de reabertura terminou. Atualize a página.";
  }
  if (error === "missing") return "Não foi possível alterar esta solicitação.";
  if (error) return "Não foi possível concluir a operação.";
  return null;
}

export default async function RequestPage({
  params,
  searchParams,
}: RequestPageProps) {
  await requireRequesterPageAccess();
  const [{ requestId }, { notice, error }] = await Promise.all([params, searchParams]);
  let request;
  let attachments;
  let answers;
  let comments;

  try {
    request = await getRequesterRequest(requestId);
    attachments = await listRequestAttachments(request.id);
    answers = await listRequestFieldAnswers(request.id);
    comments = await listComments(request.id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  return (
    <main className="page-shell">
      <header className="detail-heading">
      <nav aria-label="Navegação das solicitações">
        <Link href="/requests">Minhas solicitações</Link>
      </nav>
      </header>
      {feedback(notice, error) ? (
        <p className={`feedback${error ? " feedback-error" : ""}`} role={error ? "alert" : "status"}>
          {feedback(notice, error)}
        </p>
      ) : null}
      <article className="surface-card">
        <p className="eyebrow">Solicitação</p>
        <h1>{request.serviceNameSnapshot}</h1>
        <p>
          <span className="status-pill">{statusLabels[request.status]}</span>{" "}
          <RequestStageLabel request={request} />
        </p>
        <RequestSla request={request} now={new Date()} />
        <p>Categoria: {request.categoryNameSnapshot}</p>
        <p>Setor responsável: {request.sectorNameSnapshot}</p>
        <p>
          Atendente responsável:{" "}
          {effectiveAssigneeId(request) !== null && request.assignee
            ? request.assignee.name
            : "ainda não definido"}
        </p>
        <p>{request.serviceDescriptionSnapshot}</p>
        <RequestStageSteps request={request} />
        <h2>Sua descrição</h2>
        <p className="request-description">{request.description}</p>
      </article>
      <RequestFieldAnswers answers={answers} />
      <RequestAttachments requestId={request.id} attachments={attachments} />
      <LifecyclePanel request={request} now={new Date()} />
      <RequestConversation
        requestId={request.id}
        comments={comments}
        canWrite={request.status !== "CANCELLED"}
        allowInternal={false}
        action={addOwnCommentAction}
      />
      <RequestTimeline request={request} actorLabel="Responsável pelo evento" />
    </main>
  );
}
