import Link from "next/link";
import { RequestStageLabel } from "@/app/_components/request-stage";
import { RequestApprovalLabel } from "@/app/_components/request-approval";
import { countComments } from "@/modules/comments";
import { effectiveAssigneeId, getTeamLoad, listBatchChoices, listQueueStageChoices, searchAttendantQueue, type RequestSearchResult } from "@/modules/requests";
import { QueueBatch } from "./queue-batch";
import { QUEUE_BATCH_FORM_ID } from "./queue-batch-form";
import { listQueuePageTags, listQueueTags } from "@/modules/tags";
import { checklistProgressLabel, listQueuePageChecklists } from "@/modules/checklists";
import { TagChip } from "@/app/_components/sector-tags";
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
import { listFollowedElsewhere } from "@/modules/followers";
import { requestShortCode } from "@/shared/requests";

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
  // SPEC 2026-11-08-atendimento-dia-a-dia, 3.3 items 4 and 5: the sector's tags, for the filter and the batch.
  const sectorTags = await listQueueTags();

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
  // SPEC 2026-11-08-atendimento-dia-a-dia, 3.3 item 4: the tags of the page's requests.
  const pageTags = await listQueuePageTags(requests.map(({ id }) => id));
  // SPEC 2026-11-08-atendimento-dia-a-dia, 13.3 item 1: with "Que eu acompanho", the ones now in another sector.
  const elsewhere = params.following === "1" ? await listFollowedElsewhere() : [];
  // SPEC 2026-11-08-atendimento-dia-a-dia, 13.1 item 3: the checklist's progress of the page's requests.
  const pageChecklists = await listQueuePageChecklists(requests.map(({ id }) => id));
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
      <RequestSearchForm basePath="/queue" params={params} showAssignee showSla stageChoices={stageChoices} tagChoices={sectorTags} defaultOrder="oldest" />
      <SavedViews list="QUEUE" params={params} views={views} />
      {/* Always rendered, so the batch's result stays when it empties the page (SPEC 2026-11-08-atendimento-dia-a-dia, 3.3 item 5). */}
      {result !== null ? <QueueBatch choices={batchChoices} empty={requests.length === 0} labels={batchLabels} tags={sectorTags} /> : null}
      {elsewhere.length > 0 ? (
        <section aria-labelledby="elsewhere-heading" className="surface-card content-section">
          <h2 id="elsewhere-heading">Acompanho em outros setores</h2>
          <p className="section-description">Encaminhadas depois que você passou a acompanhar. O detalhe fica com o setor atual.</p>
          <ul aria-label="Acompanho em outros setores">
            {elsewhere.map((item) => (
              <li key={item.requestId}>
                #{requestShortCode(item.requestId)} · {item.serviceName} · {statusLabels[item.status]} · Setor: {item.sectorName}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
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
              {pageChecklists.get(request.id) ? (
                <p className="metadata">{checklistProgressLabel(pageChecklists.get(request.id)!)}</p>
              ) : null}
              {pageTags.get(request.id)?.length ? (
                <p aria-label="Etiquetas" className="tag-line">
                  {pageTags.get(request.id)!.map((tag) => (
                    <TagChip color={tag.color} key={tag.id} muted={tag.fromOtherSector || !tag.isActive} name={tag.name} />
                  ))}
                </p>
              ) : null}
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
