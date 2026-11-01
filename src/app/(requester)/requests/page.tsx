import Link from "next/link";
import { RequestStageLabel } from "@/app/_components/request-stage";
import { RequestApprovalLabel } from "@/app/_components/request-approval";
import { countComments } from "@/modules/comments";
import { searchRequesterRequests, type RequestSearchResult } from "@/modules/requests";
import { ValidationError } from "@/server/errors";
import { RequestPagination } from "@/app/_components/request-pagination";
import { RequestSearchForm } from "@/app/_components/request-search-form";
import { hasSearchCriteria, type SearchParams } from "@/app/_components/request-search-url";
import { RequestSla } from "@/app/_components/request-sla";
import { requireRequesterPageAccess } from "../page-access";
import { REQUEST_STATUS_LABELS } from "@/app/_components/request-status";

const statusLabels = REQUEST_STATUS_LABELS;

type RequestListPageProps = {
  searchParams: Promise<SearchParams>;
};

export default async function RequestListPage({ searchParams }: RequestListPageProps) {
  await requireRequesterPageAccess();
  const params = await searchParams;
  let result: RequestSearchResult | null = null;

  try {
    result = await searchRequesterRequests(params);
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
          <p className="eyebrow">Acompanhamento</p>
        <h1>Minhas solicitações</h1>
        </div>
        <Link href="/catalog">Voltar ao catálogo</Link>
      </header>
      <RequestSearchForm basePath="/requests" params={params} showAssignee={false} defaultOrder="newest" />
      {result === null ? (
        <p className="feedback feedback-error" role="alert">
          Critérios de busca inválidos. Use de 2 a 100 caracteres na busca, datas válidas (a inicial antes da final) e as opções oferecidas.
        </p>
      ) : requests.length === 0 ? (
        <p className="empty-state">
          {hasSearchCriteria(params)
            ? "Nenhuma solicitação encontrada com esses critérios."
            : "Você ainda não abriu solicitações."}
        </p>
      ) : (
        <ul className="content-list">
          {requests.map((request) => (
            <li key={request.id}>
              <h2>
                <Link href={`/requests/${request.id}`}>
                  {request.serviceNameSnapshot}
                </Link>
              </h2>
              <p>
                <span className="status-pill">{statusLabels[request.status]}</span>{" "}
                <RequestStageLabel request={request} />{" "}
                <RequestApprovalLabel request={request} />
              </p>
              <RequestSla request={request} now={now} />
              <p className="metadata">
                {(commentCounts.get(request.id) ?? 0) === 1
                  ? "1 comentário"
                  : `${commentCounts.get(request.id) ?? 0} comentários`}
              </p>
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
          basePath="/requests"
          params={params}
          page={result.page}
          pageCount={result.pageCount}
          total={result.total}
        />
      ) : null}
    </main>
  );
}
