import Link from "next/link";
import { notFound } from "next/navigation";
import { getAttendantRequest, listRequestAttachments } from "@/modules/requests";
import { RequestAttachments } from "@/app/_components/request-attachments";
import { NotFoundError } from "@/server/errors";
import { requireAttendantPageAccess } from "../../page-access";
import { completeRequestAction, startRequestAction } from "../actions";
import { REQUEST_STATUS_LABELS } from "@/app/_components/request-status";

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
  return null;
}

export default async function QueueRequestPage({
  params,
  searchParams,
}: QueueRequestPageProps) {
  await requireAttendantPageAccess();
  const [{ requestId }, { error, notice }] = await Promise.all([
    params,
    searchParams,
  ]);
  let request;
  let attachments;

  try {
    request = await getAttendantRequest(requestId);
    attachments = await listRequestAttachments(request.id);
  } catch (caught) {
    if (caught instanceof NotFoundError) notFound();
    throw caught;
  }

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
        <p>Categoria: {request.categoryNameSnapshot}</p>
        <p>Setor de origem: {request.sectorNameSnapshot}</p>
        <p>{request.serviceDescriptionSnapshot}</p>
        <h2>Descrição da solicitação</h2>
        <p className="request-description">{request.description}</p>
      </article>
      {request.status === "OPEN" ? (
        <form className="content-section" action={startRequestAction}>
          <input type="hidden" name="requestId" value={request.id} />
          <button type="submit">Iniciar atendimento</button>
        </form>
      ) : null}
      {request.status === "IN_PROGRESS" ? (
        <form className="content-section" action={completeRequestAction}>
          <input type="hidden" name="requestId" value={request.id} />
          <button type="submit">Concluir solicitação</button>
        </form>
      ) : null}
      <RequestAttachments requestId={request.id} attachments={attachments} />
      <section className="surface-card content-section" aria-labelledby="history-heading">
        <p className="eyebrow">Rastreabilidade</p>
        <h2 id="history-heading">Histórico</h2>
        <ol className="history-list">
          {request.events.map((event) => (
            <li key={event.id}>
              <p>
                {event.fromStatus
                  ? `${statusLabels[event.fromStatus]} → ${statusLabels[event.toStatus]}`
                  : `Solicitação aberta: ${statusLabels[event.toStatus]}`}
              </p>
              <p>Atendente: {event.actor.name}</p>
              <time dateTime={event.occurredAt.toISOString()}>
                {event.occurredAt.toLocaleString("pt-BR")}
              </time>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
