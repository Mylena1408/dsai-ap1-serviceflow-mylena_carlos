import Link from "next/link";
import { RequestStageLabel } from "@/app/_components/request-stage";
import { countComments } from "@/modules/comments";
import { effectiveAssigneeId, searchAttendantQueue, type RequestSearchResult } from "@/modules/requests";
import { ValidationError } from "@/server/errors";
import { RequestPagination } from "@/app/_components/request-pagination";
import { RequestSearchForm } from "@/app/_components/request-search-form";
import { hasSearchCriteria, type SearchParams } from "@/app/_components/request-search-url";
import { RequestSla } from "@/app/_components/request-sla";
import { requireAttendantPageAccess } from "../page-access";
import { REQUEST_STATUS_LABELS } from "@/app/_components/request-status";

const statusLabels = REQUEST_STATUS_LABELS;

function commentLabel(count: number): string {
  return count === 1 ? "1 comentário" : `${count} comentários`;
}

type AttendantQueuePageProps = {
  searchParams: Promise<SearchParams>;
};

export default async function AttendantQueuePage({ searchParams }: AttendantQueuePageProps) {
  const actor = await requireAttendantPageAccess();
  const params = await searchParams;
  let result: RequestSearchResult | null = null;

  try {
    result = await searchAttendantQueue(params);
  } catch (error) {
    // Invalid criteria show a fixed message instead of a wrongly filtered list.
    if (!(error instanceof ValidationError)) throw error;
  }

  const requests = result?.items ?? [];
  const commentCounts = await countComments(requests.map(({ id }) => id));
  const now = new Date();

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Atendimento</p>
          <h1>Fila do meu setor</h1>
          <p>Solicitações encaminhadas à equipe que você atende.</p>
        </div>
      </header>
      <RequestSearchForm basePath="/queue" params={params} showAssignee showSla defaultOrder="oldest" />
      {result === null ? (
        <p className="feedback feedback-error" role="alert">
          Critérios de busca inválidos. Use de 2 a 100 caracteres na busca, datas válidas (a inicial antes da final) e as opções oferecidas.
        </p>
      ) : requests.length === 0 ? (
        <p className="empty-state">
          {hasSearchCriteria(params)
            ? "Nenhuma solicitação encontrada com esses critérios."
            : "Não há solicitações no setor."}
        </p>
      ) : (
        <ul className="content-list">
          {requests.map((request) => (
            <li key={request.id}>
              <h2>
                <Link href={`/queue/${request.id}`}>
                  {request.serviceNameSnapshot}
                </Link>
              </h2>
              <p>
                <span className="status-pill">{statusLabels[request.status]}</span>{" "}
                <RequestStageLabel request={request} />
              </p>
              <RequestSla request={request} now={now} />
              <p className="metadata">
                Responsável:{" "}
                {effectiveAssigneeId(request) === null
                  ? "ninguém"
                  : effectiveAssigneeId(request) === actor.id
                    ? "você"
                    : request.assignee?.name}
              </p>
              <p>{request.description}</p>
              <p className="metadata">{commentLabel(commentCounts.get(request.id) ?? 0)}</p>
              <p className="metadata">
                Aberta em{" "}
                <time dateTime={request.createdAt.toISOString()}>
                  {request.createdAt.toLocaleString("pt-BR")}
                </time>
              </p>
            </li>
          ))}
        </ul>
      )}
      {result && result.total > 0 ? (
        <RequestPagination
          basePath="/queue"
          params={params}
          page={result.page}
          pageCount={result.pageCount}
          total={result.total}
        />
      ) : null}
    </main>
  );
}
