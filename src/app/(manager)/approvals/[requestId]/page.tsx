import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getApprovalActingSectors,
  getApprovalLevels,
  pendingApprovalSector,
  getManagerRequest,
  getRequestSatisfaction,
  listRequestAttachments,
  listRequestEscalations,
  listRequestFieldAnswers,
  listRequestLinks,
  getRequestGroupBlock,
} from "@/modules/requests";
import { RequestLinks } from "@/app/_components/request-links";
import { RequestGroupBlock } from "@/app/_components/request-group";
import { RequestEscalations } from "@/app/_components/request-escalations";
import { TeamSatisfaction } from "@/app/_components/request-satisfaction";
import { NotFoundError } from "@/server/errors";
import { RequestApprovalLabel } from "@/app/_components/request-approval";
import { RequestAttachments } from "@/app/_components/request-attachments";
import { RequestFieldAnswers } from "@/app/_components/request-field-answers";
import { RequestSla } from "@/app/_components/request-sla";
import { REQUEST_STATUS_LABELS } from "@/app/_components/request-status";
import { RequestTimeline } from "@/app/_components/request-timeline";
import { RequestTags } from "@/app/_components/request-tags";
import { getRequestTags } from "@/modules/tags";
import { getRequestChecklist } from "@/modules/checklists";
import { RequestChecklist } from "@/app/_components/request-checklist";
import { getRequestTime } from "@/modules/time-entries";
import { RequestTime } from "@/app/_components/request-time";
import { getRequestFollowers } from "@/modules/followers";
import { RequestFollowers } from "@/app/_components/request-followers";
import { ApprovalLevels } from "@/app/_components/approval-levels";
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
  let satisfaction;
  let escalations: Awaited<ReturnType<typeof listRequestEscalations>> = [];
  let links: Awaited<ReturnType<typeof listRequestLinks>> = { links: [], events: [] };
  let group: Awaited<ReturnType<typeof getRequestGroupBlock>> = null;
  let actingSectors: string[] = [];
  let levels: Awaited<ReturnType<typeof getApprovalLevels>> = null;

  try {
    request = await getManagerRequest(requestId);
    attachments = await listRequestAttachments(request.id);
    answers = await listRequestFieldAnswers(request.id);
    satisfaction = await getRequestSatisfaction(request.id);
    escalations = await listRequestEscalations(request.id);
    // SPEC 2026-11-07-operacao-e-automacao, 3.3 item 1: read only.
    links = await listRequestLinks(request.id);
    // SPEC 2026-11-07-operacao-e-automacao, 3.3 item 4.
    group = await getRequestGroupBlock(request.id);
    actingSectors = await getApprovalActingSectors();
    // SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.3 to 4.3.6.
    levels = await getApprovalLevels(request);
  } catch (caught) {
    if (caught instanceof NotFoundError) notFound();
    throw caught;
  }

  // SPEC 2026-11-08-atendimento-dia-a-dia, 3.3 item 2 (decision I2): the sector's manager reads the tags; a
  // manager who only decides an approval of another sector is not on its team and sees none.
  let tags: Awaited<ReturnType<typeof getRequestTags>> | null = null;
  // SPEC 2026-11-08-atendimento-dia-a-dia, 4.3 item 3 (decision I6): the same team reads the checklist.
  let checklist: Awaited<ReturnType<typeof getRequestChecklist>> | null = null;
  let time: Awaited<ReturnType<typeof getRequestTime>> | null = null;
  let followers: Awaited<ReturnType<typeof getRequestFollowers>> | null = null;
  try {
    tags = await getRequestTags(request.id);
    checklist = await getRequestChecklist(request.id);
    // SPEC 2026-11-08-atendimento-dia-a-dia, 5.1 item 2: the manager reads the time too.
    time = await getRequestTime(request.id);
    // SPEC 2026-11-08-atendimento-dia-a-dia, 13.3 item 3: the manager sees who follows.
    followers = await getRequestFollowers(request.id);
  } catch (caught) {
    if (!(caught instanceof NotFoundError)) throw caught;
  }

  const message = feedback(error, notice);
  const open = request.approvalState === "PENDING" && request.status === "OPEN";
  // SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.4: only the pending level's managers
  // decide; managers of the other levels see the request and wait.
  // In an absence, the substitute decides the absent manager's sector too (4.3.5).
  const pendingSector = pendingApprovalSector(request);
  const pending = open && pendingSector !== null && actingSectors.includes(pendingSector);
  const waitingOtherLevel = open && !pending;

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
      {waitingOtherLevel ? (
        <p className="feedback" role="status">
          Esta solicitação aguarda a decisão de outro nível de aprovação.
        </p>
      ) : null}
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
      <ApprovalLevels view={levels} />
      <RequestFieldAnswers answers={answers} />
      <RequestAttachments requestId={request.id} attachments={attachments} />
      <TeamSatisfaction view={satisfaction} />
      <RequestEscalations escalations={escalations} />
      <RequestLinks hrefFor={(id) => `/approvals/${id}`} links={links.links} requestId={request.id} />
      <RequestGroupBlock block={group} hrefFor={(id) => `/approvals/${id}`} />
      {tags ? <RequestTags requestId={request.id} view={tags} /> : null}
      {/* SPEC 2026-11-08-atendimento-dia-a-dia, 4.3 item 3: the manager only reads. */}
      {checklist ? <RequestChecklist requestId={request.id} view={checklist} /> : null}
      {time ? <RequestTime requestId={request.id} view={time} /> : null}
      {followers ? <RequestFollowers area="manager" requestId={request.id} view={followers} /> : null}
      <RequestTimeline request={request} actorLabel="Responsável pelo evento" linkEvents={links.events} tagEvents={tags?.events ?? []} checklistEvents={checklist?.events ?? []} timeEvents={time?.events ?? []} followerEvents={followers?.events ?? []} />
    </main>
  );
}
