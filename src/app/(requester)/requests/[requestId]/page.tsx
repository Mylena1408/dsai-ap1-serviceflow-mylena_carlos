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

type RequestPageProps = {
  params: Promise<{ requestId: string }>;
  searchParams: Promise<{ notice?: string }>;
};

const statusLabels = REQUEST_STATUS_LABELS;

export default async function RequestPage({
  params,
  searchParams,
}: RequestPageProps) {
  await requireRequesterPageAccess();
  const [{ requestId }, { notice }] = await Promise.all([params, searchParams]);
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
      {notice === "created" ? (
        <p className="feedback" role="status">Sua solicitação foi aberta.</p>
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
