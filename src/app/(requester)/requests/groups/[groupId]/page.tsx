import Link from "next/link";
import { notFound } from "next/navigation";
import { getRequesterGroup, groupProgressText, groupStateLabel } from "@/modules/requests";
import { NotFoundError } from "@/server/errors";
import { requestShortCode } from "@/shared/requests";
import { REQUEST_STATUS_LABELS } from "@/app/_components/request-status";
import { requireRequesterPageAccess } from "../../../page-access";
import { cancelGroupAction } from "../actions";
import { cancellationMessage, countParam, groupErrorMessage } from "../group-messages";

// A bundle the requester opened (SPEC 2026-11-07-operacao-e-automacao, 3.3 item 4): the progress, each
// request with its status, and the cancellation of what can still be cancelled.

type GroupPageProps = {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ cancelled?: string; kept?: string; error?: string }>;
};

export default async function GroupPage({ params, searchParams }: GroupPageProps) {
  await requireRequesterPageAccess();
  const [{ groupId }, query] = await Promise.all([params, searchParams]);
  let group;

  try {
    group = await getRequesterGroup(groupId);
  } catch (caught) {
    if (caught instanceof NotFoundError) notFound();
    throw caught;
  }

  const cancelled = countParam(query.cancelled);
  const kept = countParam(query.kept);
  const error = groupErrorMessage(query.error);

  return (
    <main className="page-shell">
      <header className="detail-heading">
        <nav aria-label="Navegação das solicitações">
          <Link href="/requests">Minhas solicitações</Link>
        </nav>
      </header>
      {cancelled !== null && kept !== null ? (
        <p className="feedback" role="status">
          {cancellationMessage(cancelled, kept)}
        </p>
      ) : null}
      {error ? (
        <p className="feedback feedback-error" role="alert">
          {error}
        </p>
      ) : null}
      <article className="surface-card">
        <p className="eyebrow">Pacote de serviços</p>
        <h1>{group.bundleName}</h1>
        <p>
          <span className="status-pill">{groupStateLabel(group.progress)}</span> {groupProgressText(group.progress)}
        </p>
        <p className="metadata">
          Aberto em <time dateTime={group.createdAt.toISOString()}>{group.createdAt.toLocaleString("pt-BR")}</time>
        </p>
      </article>
      <section className="surface-card content-section" aria-labelledby="group-requests-heading">
        <h2 id="group-requests-heading">Solicitações do pacote</h2>
        <ol className="content-list">
          {group.requests.map((request) => (
            <li key={request.id}>
              <Link href={`/requests/${request.id}`}>
                #{requestShortCode(request.id)} · {request.serviceName}
              </Link>{" "}
              · {request.sectorName} · <span className="status-pill">{REQUEST_STATUS_LABELS[request.status]}</span>
              {request.approvalState === "PENDING" ? " · aguardando aprovação" : null}
            </li>
          ))}
        </ol>
      </section>
      {group.cancellable ? (
        <section className="surface-card content-section" aria-labelledby="group-cancel-heading">
          <h2 id="group-cancel-heading">Cancelar o pacote</h2>
          <p className="section-description">
            Cancela as solicitações que ainda estão abertas. As que já estão em atendimento ou encerradas continuam como estão.
          </p>
          <form action={cancelGroupAction} className="create-form">
            <input name="groupId" type="hidden" value={group.id} />
            <label>
              Justificativa (opcional)
              <textarea maxLength={1000} name="note" rows={2} />
            </label>
            <button className="button-danger" type="submit">
              Cancelar o pacote
            </button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
