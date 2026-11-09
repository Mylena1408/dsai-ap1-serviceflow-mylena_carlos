import Link from "next/link";
import { notFound } from "next/navigation";
import { formatFieldAnswer, type ServiceFieldType } from "@/modules/service-fields";
import { getFollowedRequest } from "@/modules/requests";
import { getFollowerReading, getRequestFollowers } from "@/modules/followers";
import { NotFoundError } from "@/server/errors";
import { REQUEST_STATUS_LABELS } from "@/app/_components/request-status";
import { RequestStageLabel, RequestStageSteps } from "@/app/_components/request-stage";
import { RequestTimeline } from "@/app/_components/request-timeline";
import { RequestFollowers } from "@/app/_components/request-followers";
import { requireRequesterPageAccess } from "../../../page-access";

// A colleague's reading of a request they follow (SPEC 2026-11-08-atendimento-dia-a-dia, 6.3 item 2; decision I13):
// the request, its history, the public comments, the requester's answers and the documents' names; no action but
// stopping to follow. Anyone else is told it does not exist.

type FollowedRequestPageProps = {
  params: Promise<{ requestId: string }>;
  searchParams: Promise<{ follow?: string }>;
};

function size(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

export default async function FollowedRequestPage({ params, searchParams }: FollowedRequestPageProps) {
  await requireRequesterPageAccess();
  const [{ requestId }, { follow }] = await Promise.all([params, searchParams]);
  let request;
  let reading;
  let followers;
  try {
    request = await getFollowedRequest(requestId);
    [reading, followers] = await Promise.all([getFollowerReading(request.id), getRequestFollowers(request.id)]);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  return (
    <main className="page-shell">
      <header className="detail-heading">
        <nav aria-label="Navegação das solicitações">
          <Link href="/requests/following">Que eu acompanho</Link>
        </nav>
      </header>
      <article className="surface-card">
        <p className="eyebrow">Solicitação que você acompanha</p>
        <h1>{request.serviceNameSnapshot}</h1>
        <p>
          <span className="status-pill">{REQUEST_STATUS_LABELS[request.status]}</span> <RequestStageLabel request={request} />
        </p>
        <p>Categoria: {request.categoryNameSnapshot}</p>
        <p>Setor responsável: {request.sectorNameSnapshot}</p>
        <RequestStageSteps request={request} />
        <h2>Descrição</h2>
        <p className="request-description">{request.description}</p>
      </article>
      {reading.answers.length > 0 ? (
        <section aria-labelledby="answers-heading" className="surface-card content-section">
          <h2 id="answers-heading">Respostas do formulário</h2>
          <dl>
            {reading.answers.map((answer) => (
              <div key={answer.label}>
                <dt>{answer.label}</dt>
                <dd>{formatFieldAnswer(answer.type as ServiceFieldType, answer.value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      {reading.documents.length > 0 ? (
        <section aria-labelledby="documents-heading" className="surface-card content-section">
          <h2 id="documents-heading">Documentos</h2>
          <ul>
            {reading.documents.map((document, index) => (
              <li key={`${document.name}-${index}`}>
                {document.name} · {document.format} · {document.removed ? "removido" : size(document.sizeBytes)}
              </li>
            ))}
          </ul>
          <p className="section-description">Só quem abriu a solicitação e a equipe baixam os arquivos.</p>
        </section>
      ) : null}
      <section aria-labelledby="comments-heading" className="surface-card content-section">
        <h2 id="comments-heading">Comentários</h2>
        {reading.comments.length === 0 ? (
          <p className="section-description">Nenhum comentário.</p>
        ) : (
          <ol className="history-list">
            {reading.comments.map((comment) => (
              <li key={comment.id}>
                <p>{comment.body}</p>
                <p className="metadata">
                  {comment.authorName} · <time dateTime={comment.createdAt.toISOString()}>{comment.createdAt.toLocaleString("pt-BR")}</time>
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
      <RequestFollowers area="following" message={follow} requestId={request.id} view={followers} />
      <RequestTimeline request={request} actorLabel="Responsável pelo evento" followerEvents={followers.events} />
    </main>
  );
}
