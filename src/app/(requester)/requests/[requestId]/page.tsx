import Link from "next/link";
import { notFound } from "next/navigation";
import {
  effectiveAssigneeId,
  getRequesterRequest,
  listRequestAttachments,
} from "@/modules/requests";
import { RequestAttachments } from "@/app/_components/request-attachments";
import { NotFoundError } from "@/server/errors";
import { requireRequesterPageAccess } from "../../page-access";
import { REQUEST_STATUS_LABELS } from "@/app/_components/request-status";
import { LifecyclePanel } from "./lifecycle-panel";

type RequestPageProps = {
  params: Promise<{ requestId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
};

const statusLabels = REQUEST_STATUS_LABELS;

function feedback(notice?: string, error?: string): string | null {
  if (notice === "created") return "Sua solicitação foi aberta.";
  if (notice === "cancelled") return "Sua solicitação foi cancelada.";
  if (error === "note") return "O motivo pode ter no máximo 1.000 caracteres.";
  if (error === "state") return "A solicitação mudou de estado e não pode mais ser alterada assim. Atualize a página.";
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

  try {
    request = await getRequesterRequest(requestId);
    attachments = await listRequestAttachments(request.id);
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
        <p><span className="status-pill">{statusLabels[request.status]}</span></p>
        <p>Categoria: {request.categoryNameSnapshot}</p>
        <p>Setor responsável: {request.sectorNameSnapshot}</p>
        <p>
          Atendente responsável:{" "}
          {effectiveAssigneeId(request) !== null && request.assignee
            ? request.assignee.name
            : "ainda não definido"}
        </p>
        <p>{request.serviceDescriptionSnapshot}</p>
        <h2>Sua descrição</h2>
        <p className="request-description">{request.description}</p>
      </article>
      <RequestAttachments requestId={request.id} attachments={attachments} />
      <LifecyclePanel request={request} />
      <section className="surface-card content-section" aria-labelledby="history-heading">
        <p className="eyebrow">Rastreabilidade</p>
        <h2 id="history-heading">Histórico</h2>
        {request.events.length === 0 ? (
          <p className="empty-state">Nenhum evento registrado.</p>
        ) : (
          <ol className="history-list">
            {request.events.map((event) => (
              <li key={event.id}>
                <p>
                  {event.fromStatus
                    ? `${statusLabels[event.fromStatus]} → ${statusLabels[event.toStatus]}`
                    : `Solicitação aberta: ${statusLabels[event.toStatus]}`}
                </p>
                <p>Responsável pelo evento: {event.actor.name}</p>
                <time dateTime={event.occurredAt.toISOString()}>
                  {event.occurredAt.toLocaleString("pt-BR")}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
