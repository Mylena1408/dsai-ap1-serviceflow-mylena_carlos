import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getRequestGroupBlock,
  listRequestLinks,
  effectiveAssigneeId,
  getAttendanceFields,
  getAttendantRequest,
  getRequestSatisfaction,
  listRequestAttachments,
  listRequestEscalations,
  listRequestFieldAnswers,
  listSectorDestinations,
  listTransferCandidates,
  getApprovalLevels,
} from "@/modules/requests";
import { RequestAttachments } from "@/app/_components/request-attachments";
import { RequestFieldAnswers } from "@/app/_components/request-field-answers";
import { RequestStageLabel } from "@/app/_components/request-stage";
import { RequestApprovalLabel } from "@/app/_components/request-approval";
import { StagePanel } from "./stage-panel";
import { NotFoundError } from "@/server/errors";
import { actorHasPermission } from "@/server/authorization";
import { requireAttendantPageAccess } from "../../page-access";
import { addCommentAction, completeRequestAction, startRequestAction } from "../actions";
import { AssignmentPanel } from "./assignment-panel";
import { CancelRequestForm } from "./cancel-request-form";
import { RequestSla } from "@/app/_components/request-sla";
import { PriorityForm } from "./priority-form";
import { SectorTransferForm } from "./sector-transfer-form";
import { SlaPausePanel } from "./sla-pause-panel";
import { AttendanceFieldsForm } from "./attendance-fields-form";
import { listComments } from "@/modules/comments";
import { RequestConversation } from "@/app/_components/request-conversation";
import { REQUEST_STATUS_LABELS } from "@/app/_components/request-status";
import { RequestTimeline } from "@/app/_components/request-timeline";
import { ApprovalLevels } from "@/app/_components/approval-levels";
import { TeamSatisfaction } from "@/app/_components/request-satisfaction";
import { listResponsesForRequest } from "@/modules/canned-responses";
import { RequestEscalations } from "@/app/_components/request-escalations";
import { RequestLinks } from "@/app/_components/request-links";
import { RequestTags } from "@/app/_components/request-tags";
import { getRequestTags } from "@/modules/tags";
import { getRequestChecklist } from "@/modules/checklists";
import { RequestChecklist, checklistFeedback, checklistPendingText } from "@/app/_components/request-checklist";
import { markChecklistItemAction } from "../checklist-actions";
import { getRequestTime } from "@/modules/time-entries";
import { RequestTime } from "@/app/_components/request-time";
import { addRequestTagAction, removeRequestTagAction } from "../tag-actions";
import { RequestGroupBlock } from "@/app/_components/request-group";
import { linkRequestAction, unlinkRequestAction } from "../link-actions";
import { COMMENT_FILE_MESSAGES } from "@/app/_components/comment-form-data";

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
  if (notice === "stage") return "Etapa alterada.";
  if (notice === "paused") return "Prazo pausado. O solicitante foi avisado.";
  if (notice === "resumed") return "Prazo retomado.";
  if (error === "pause-reason") return "Informe o motivo da pausa, com até 500 caracteres.";
  // SPEC 2026-11-03-campos-condicionais-atendimento, 5.5.
  if (notice === "attendance-saved") return "Informações do atendimento salvas.";
  if (error === "attendance-required") return "Preencha as informações do atendimento obrigatórias antes de concluir.";
  if (error === "attendance-invalid") return "Confira as informações do atendimento: há valores inválidos.";
  if (error === "attendance-changed") return "Os campos do atendimento mudaram. Atualize a página e preencha de novo.";
  if (error === "stage-note") return "Informe a justificativa do retorno, com até 1.000 caracteres.";
  if (error === "priority") return "Escolha uma prioridade diferente da atual.";
  if (error === "body") return "Escreva um comentário com até 5.000 caracteres.";
  if (error && COMMENT_FILE_MESSAGES[error]) return COMMENT_FILE_MESSAGES[error];
  if (error === "note") return "Informe a justificativa do cancelamento, com até 1.000 caracteres.";
  if (error === "sector-note") return "Informe a justificativa do encaminhamento, com até 1.000 caracteres.";
  if (error === "sector") return "Escolha um setor ativo, diferente do atual e com atendente ativo.";
  // SPEC 2026-11-07-operacao-e-automacao, 3.3 item 1.
  if (notice === "linked") return "Solicitação vinculada.";
  if (notice === "unlinked") return "Vínculo removido.";
  if (error === "link-code") return "Informe o código de 8 caracteres de outra solicitação, diferente desta.";
  if (error === "link-missing") return "Não há solicitação com esse código que você possa ver.";
  if (error === "link-conflict")
    return "Não foi possível vincular: as duas já estão vinculadas, uma delas já tem 10 vínculos, ou a duplicada já é duplicada ou original de outra.";
  // SPEC 2026-11-08-atendimento-dia-a-dia, 3.3 item 2.
  if (notice === "tagged") return "Etiqueta aplicada.";
  if (notice === "untagged") return "Etiqueta retirada.";
  if (error === "tag-limit") return "Uma solicitação tem no máximo 5 etiquetas.";
  if (error === "tag-invalid") return "Escolha uma etiqueta ativa do setor.";
  if (error === "tag-state") return "Não é possível mudar as etiquetas de uma solicitação cancelada, ou ela mudou enquanto você agia.";
  // SPEC 2026-11-08-atendimento-dia-a-dia, 4.3 item 4; the pending items are listed next to it.
  if (error === "checklist-pending") return "Não foi possível concluir: há itens obrigatórios do checklist por marcar.";
  // SPEC 2026-11-08-atendimento-dia-a-dia, 4.3 item 3.
  const checklistMessage = checklistFeedback(error) ?? checklistFeedback(notice);
  if (checklistMessage) return checklistMessage;
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
  let satisfaction;
  let escalations: Awaited<ReturnType<typeof listRequestEscalations>> = [];
  let links: Awaited<ReturnType<typeof listRequestLinks>> = { links: [], events: [] };
  let group: Awaited<ReturnType<typeof getRequestGroupBlock>> = null;
  let tags: Awaited<ReturnType<typeof getRequestTags>> | null = null;
  let checklist: Awaited<ReturnType<typeof getRequestChecklist>> | null = null;
  let time: Awaited<ReturnType<typeof getRequestTime>> | null = null;
  let cannedResponses: Array<{ id: string; title: string; text: string }> = [];
  let candidates: Array<{ id: string; name: string }> = [];
  let destinations: Array<{ id: string; name: string }> = [];
  let attendance: Awaited<ReturnType<typeof getAttendanceFields>> = { fields: [], values: {} };
  // SPEC 2026-11-01-permissoes-configuraveis, 5.3.3.
  const supervisor = await actorHasPermission(actor, "QUEUE_SUPERVISION");

  try {
    request = await getAttendantRequest(requestId);
    attachments = await listRequestAttachments(request.id);
    answers = await listRequestFieldAnswers(request.id);
    comments = await listComments(request.id);
    satisfaction = await getRequestSatisfaction(request.id);
    // SPEC 2026-11-06-respostas-prontas, 4.4: rendered with what the attendant already sees.
    cannedResponses = await listResponsesForRequest(request.id);
    escalations = await listRequestEscalations(request.id);
    links = await listRequestLinks(request.id);
    // SPEC 2026-11-07-operacao-e-automacao, 3.3 item 4.
    group = await getRequestGroupBlock(request.id);
    // SPEC 2026-11-08-atendimento-dia-a-dia, 3.3 item 2.
    tags = await getRequestTags(request.id);
    // SPEC 2026-11-08-atendimento-dia-a-dia, 4.3 item 3.
    checklist = await getRequestChecklist(request.id);
    // SPEC 2026-11-08-atendimento-dia-a-dia, 5.1 item 2.
    time = await getRequestTime(request.id);
    attendance = await getAttendanceFields(request.id);
    const holderId = effectiveAssigneeId(request);
    if (holderId === actor.id || (supervisor && holderId !== null)) {
      candidates = await listTransferCandidates(request.id);
    }
    // SPEC 2026-11-03-transferencia-entre-setores, 5.1: open, without a pending approval, and the
    // holder, a supervisor or anyone when nobody holds it.
    if (
      request.status === "OPEN" &&
      request.approvalState !== "PENDING" &&
      (holderId === null || holderId === actor.id || supervisor)
    ) {
      destinations = await listSectorDestinations(request.id);
    }
  } catch (caught) {
    if (caught instanceof NotFoundError) notFound();
    throw caught;
  }

  // Section 5.3: with an effective assignee only that attendant starts or completes.
  const assigneeId = effectiveAssigneeId(request);
  const heldByColleague = assigneeId !== null && assigneeId !== actor.id;
  // SPEC 2026-11-01-fluxos-configuraveis, 5.3.3: with a flow, completion only at the last stage.
  // SPEC 2026-11-03-campos-condicionais-atendimento, 5.4.2.
  const attendanceFormShown =
    attendance.fields.length > 0 && (request.status === "OPEN" || request.status === "IN_PROGRESS") && (!heldByColleague || supervisor);
  const atLastStage =
    request.stageIndex === null || request.stageIndex === request.stageNamesSnapshot.length - 1;

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
          {error === "checklist-pending" && checklist ? <> {checklistPendingText(checklist.pending)}</> : null}
        </p>
      ) : null}
      <article className="surface-card">
        <p className="eyebrow">Atendimento da solicitação</p>
        <h1>{request.serviceNameSnapshot}</h1>
        <p>
          <span className="status-pill">{statusLabels[request.status]}</span>{" "}
          <RequestStageLabel request={request} showDelay />{" "}
          <RequestApprovalLabel request={request} />
        </p>
        <RequestSla request={request} now={new Date()} />
        <p>Categoria: {request.categoryNameSnapshot}</p>
        <p>Setor: {request.sectorNameSnapshot}</p>
        <p>{request.serviceDescriptionSnapshot}</p>
        <h2>Descrição da solicitação</h2>
        <p className="request-description">{request.description}</p>
      </article>
      <AssignmentPanel request={request} actorId={actor.id} candidates={candidates} supervisor={supervisor} />
      <StagePanel request={request} canAct={!heldByColleague} />
      {/* SPEC 2026-11-03-pausa-sla-calendario, 5.3 and 5.7: in progress, with an SLA, for the holder,
          a supervisor or anyone when nobody holds it. The server checks everything again. */}
      {request.status === "IN_PROGRESS" && request.slaHoursSnapshot !== null && (!heldByColleague || supervisor) ? (
        <SlaPausePanel request={request} now={new Date()} />
      ) : null}
      {destinations.length > 0 ? <SectorTransferForm requestId={request.id} destinations={destinations} /> : null}
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
      {request.approvalState === "PENDING" && request.status === "OPEN" ? (
        <p className="content-section">O atendimento só pode começar depois da aprovação do gestor do setor.</p>
      ) : null}
      {request.status === "OPEN" && !heldByColleague && request.approvalState !== "PENDING" ? (
        <form className="content-section" action={startRequestAction}>
          <input type="hidden" name="requestId" value={request.id} />
          <button type="submit">Iniciar atendimento</button>
        </form>
      ) : null}
      {request.status === "IN_PROGRESS" && !heldByColleague && atLastStage ? (
        <form className="content-section" action={completeRequestAction}>
          <input type="hidden" name="requestId" value={request.id} />
          <button type="submit">Concluir solicitação</button>
        </form>
      ) : null}
      {/* SPEC 2026-11-03-campos-condicionais-atendimento, 5.4.2: for whoever may change the priority. */}
      {attendanceFormShown ? (
        <AttendanceFieldsForm fields={attendance.fields} requestId={request.id} values={attendance.values} />
      ) : null}
      {/* While the form shows the attendance's answers, the block keeps only the requester's. */}
      {/* SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.3 to 4.3.6. */}
      <ApprovalLevels view={await getApprovalLevels(request)} />
      <RequestFieldAnswers answers={attendanceFormShown ? answers.filter((answer) => answer.audience !== "ATTENDANT") : answers} />
      <RequestAttachments requestId={request.id} attachments={attachments} />
      <TeamSatisfaction view={satisfaction} />
      <RequestEscalations escalations={escalations} />
      <RequestLinks
        edit={{ linkAction: linkRequestAction, unlinkAction: unlinkRequestAction }}
        hrefFor={(id) => `/queue/${id}`}
        links={links.links}
        requestId={request.id}
      />
      <RequestGroupBlock block={group} hrefFor={(id) => `/queue/${id}`} />
      {tags ? <RequestTags edit={{ addAction: addRequestTagAction, removeAction: removeRequestTagAction }} requestId={request.id} view={tags} /> : null}
      {/* SPEC 2026-11-08-atendimento-dia-a-dia, 4.3 item 3 and 13.1 items 3 and 4. */}
      {checklist ? <RequestChecklist markAction={markChecklistItemAction} requestId={request.id} view={checklist} /> : null}
      {time ? <RequestTime view={time} /> : null}
      <RequestConversation
        requestId={request.id}
        comments={comments}
        canWrite={request.status !== "CANCELLED"}
        allowInternal
        action={addCommentAction}
        cannedResponses={cannedResponses}
      />
      <RequestTimeline request={request} actorLabel="Responsável pelo evento" linkEvents={links.events} tagEvents={tags?.events ?? []} checklistEvents={checklist?.events ?? []} timeEvents={time?.events ?? []} />
    </main>
  );
}
