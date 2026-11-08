import Link from "next/link";
import { RequestStageLabel } from "@/app/_components/request-stage";
import { RequestApprovalLabel } from "@/app/_components/request-approval";
import { countComments } from "@/modules/comments";
import { effectiveAssigneeId, getTeamLoad, listBatchChoices, listQueueStageChoices, searchAttendantQueue, type RequestSearchResult } from "@/modules/requests";
import { QueueBatch } from "./queue-batch";
import { QUEUE_BATCH_FORM_ID } from "./queue-batch-form";
import { TeamLoad } from "@/app/_components/team-load";
import { ValidationError } from "@/server/errors";
import { RequestPagination } from "@/app/_components/request-pagination";
import { RequestSearchForm } from "@/app/_components/request-search-form";
import { hasSearchCriteria, type SearchParams } from "@/app/_components/request-search-url";
import { RequestSla } from "@/app/_components/request-sla";
import { SavedViews } from "@/app/_components/saved-views";
import { listSavedViews } from "@/modules/saved-views";
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
  // SPEC 2026-11-06-aprofundamento-configurabilidade, 5.3.4.
  const stageChoices = await listQueueStageChoices();
  // SPEC 2026-11-07-operacao-e-automacao, 4.3 item 8: for a supervisor, when the sector distributes.
  const teamLoad = (await getTeamLoad())?.filter((load) => load.mode !== "NONE") ?? null;
  // SPEC 2026-11-07-operacao-e-automacao, 7.3 item 1.
  const views = await listSavedViews("QUEUE");
  // SPEC 2026-11-07-operacao-e-automacao, 7.3 item 2.
  const batchChoices = await listBatchChoices();

  try {
    result = await searchAttendantQueue(params);
  } catch (error) {
    // Invalid criteria show a fixed message instead of a wrongly filtered list.
    if (!(error instanceof ValidationError)) throw error;
  }

  const requests = result?.items ?? [];
  const commentCounts = await countComments(requests.map(({ id }) => id));
  const now = new Date();
  // How the batch's result names each request of the page.
  const batchLabels = Object.fromEntries(requests.map((request) => [request.id, `${request.serviceNameSnapshot} (#${request.id.slice(0, 8)})`]));

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Atendimento</p>
          <h1>Fila do meu setor</h1>
          <p>Solicitações encaminhadas à equipe que você atende.</p>
        </div>
      </header>
      {params.notice === "sector-sent" ? (
        <p className="feedback" role="status">
          Solicitação encaminhada ao outro setor. Ela saiu da fila deste setor.
        </p>
      ) : null}
      <TeamLoad loads={teamLoad} />
      <RequestSearchForm basePath="/queue" params={params} showAssignee showSla stageChoices={stageChoices} defaultOrder="oldest" />
      <SavedViews list="QUEUE" params={params} views={views} />
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
        <>
        <QueueBatch choices={batchChoices} labels={batchLabels} />
        <ul className="content-list">
          {requests.map((request) => (
            <li key={request.id}>
              {/* Belongs to the batch form by its id: only the page's requests can be marked. */}
              <label className="checkbox-label">
                <input
                  aria-label={`Marcar ${batchLabels[request.id]} para ação em lote`}
                  form={QUEUE_BATCH_FORM_ID}
                  name="requestIds"
                  type="checkbox"
                  value={request.id}
                />
                Marcar para ação em lote
              </label>
              <h2>
                <Link href={`/queue/${request.id}`}>
                  {request.serviceNameSnapshot}
                </Link>
              </h2>
              <p>
                <span className="status-pill">{statusLabels[request.status]}</span>{" "}
                <RequestStageLabel request={request} showDelay />{" "}
                <RequestApprovalLabel request={request} />
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
        </>
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
