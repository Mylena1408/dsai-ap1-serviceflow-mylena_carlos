import Link from "next/link";
import { notFound } from "next/navigation";
import {
  effectiveAssigneeId,
  getRequesterRequest,
  getRequestSatisfaction,
  listMissingDocuments,
  listRequestAttachments,
  listRequestFieldAnswers,
  listRequestLinks,
  getApprovalLevels,
  getRequestGroupBlock,
  groupProgressText,
} from "@/modules/requests";
import { RequestLinks } from "@/app/_components/request-links";
import { LateDocumentForm } from "./late-document-form";
import { RequestAttachments } from "@/app/_components/request-attachments";
import { RequestFieldAnswers } from "@/app/_components/request-field-answers";
import { RequestStageLabel, RequestStageSteps } from "@/app/_components/request-stage";
import { RequestApprovalLabel } from "@/app/_components/request-approval";
import { NotFoundError } from "@/server/errors";
import { requireRequesterPageAccess } from "../../page-access";
import { REQUEST_STATUS_LABELS } from "@/app/_components/request-status";
import { RequestSla } from "@/app/_components/request-sla";
import { RequestTimeline } from "@/app/_components/request-timeline";
import { ApprovalLevels } from "@/app/_components/approval-levels";
import { LifecyclePanel } from "./lifecycle-panel";
import { listComments } from "@/modules/comments";
import { RequestConversation } from "@/app/_components/request-conversation";
import { COMMENT_FILE_MESSAGES } from "@/app/_components/comment-form-data";
import { addOwnCommentAction, rateOwnRequestAction } from "../actions";
import { RequesterSatisfaction } from "@/app/_components/request-satisfaction";

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
  if (notice === "document") return "Documento enviado.";
  if (notice === "rated") return "Obrigado pela avaliação.";
  if (error === "late-document") {
    return "O documento não foi aceito: escolha um documento que ainda falta e envie um arquivo no formato aceito, de até 2 MiB (até 4 MiB somando todos os documentos da solicitação).";
  }
  if (error === "documents-unavailable") return "O envio de documentos não está disponível agora. Tente mais tarde.";
  if (error === "rating") return "Escolha uma nota de 1 a 5 e escreva no máximo 1.000 caracteres.";
  if (error === "rating-closed") return "Esta solicitação não pode mais ser avaliada.";
  if (error === "body") return "Escreva um comentário com até 5.000 caracteres.";
  if (error && COMMENT_FILE_MESSAGES[error]) return COMMENT_FILE_MESSAGES[error];
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
  let missingDocuments;
  let satisfaction;
  let links: Awaited<ReturnType<typeof listRequestLinks>> = { links: [], events: [] };
  let group: Awaited<ReturnType<typeof getRequestGroupBlock>> = null;

  try {
    request = await getRequesterRequest(requestId);
    attachments = await listRequestAttachments(request.id);
    answers = await listRequestFieldAnswers(request.id);
    comments = await listComments(request.id);
    missingDocuments = await listMissingDocuments(request.id);
    satisfaction = await getRequestSatisfaction(request.id);
    // SPEC 2026-11-07-operacao-e-automacao, 3.3 item 1: only links between the requester's own requests.
    links = await listRequestLinks(request.id);
    // SPEC 2026-11-07-operacao-e-automacao, 3.3 item 4.
    group = await getRequestGroupBlock(request.id);
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
          <RequestStageLabel request={request} />{" "}
          <RequestApprovalLabel request={request} />
        </p>
        <RequestSla request={request} now={new Date()} />
        {/* SPEC 2026-11-03-pausa-sla-calendario, 5.3.4: the reason and how the SLA resumes. */}
        {request.slaPausedAt ? (
          <p className="feedback" role="note">
            O atendimento aguarda sua resposta
            {(() => {
              const reason = request.slaPauses?.find((pause) => pause.resumedAt === null)?.reason;
              return reason ? `: ${reason}` : ".";
            })()}{" "}
            Ao responder com um comentário, o prazo volta a contar.
          </p>
        ) : null}
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
      {/* SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.3 to 4.3.6. */}
      <ApprovalLevels view={await getApprovalLevels(request)} />
      <RequestFieldAnswers answers={answers} />
      <RequestAttachments requestId={request.id} attachments={attachments} />
      <RequestLinks hrefFor={(id) => `/requests/${id}`} links={links.links} requestId={request.id} />
      {group ? (
        <p className="content-section">
          Parte do pacote <Link href={`/requests/groups/${group.groupId}`}>{group.bundleName}</Link> ({groupProgressText(group.progress)}).
        </p>
      ) : null}
      {missingDocuments.length > 0 ? <LateDocumentForm requestId={request.id} requirements={missingDocuments} /> : null}
      <LifecyclePanel request={request} now={new Date()} />
      <RequesterSatisfaction requestId={request.id} view={satisfaction} action={rateOwnRequestAction} />
      <RequestConversation
        requestId={request.id}
        comments={comments}
        canWrite={request.status !== "CANCELLED"}
        allowInternal={false}
        action={addOwnCommentAction}
      />
      <RequestTimeline request={request} actorLabel="Responsável pelo evento" linkEvents={links.events} />
    </main>
  );
}
