import Link from "next/link";
import { countComments } from "@/modules/comments";
import { listRequesterRequests } from "@/modules/requests";
import { requireRequesterPageAccess } from "../page-access";
import { REQUEST_STATUS_LABELS } from "@/app/_components/request-status";

const statusLabels = REQUEST_STATUS_LABELS;

export default async function RequestListPage() {
  await requireRequesterPageAccess();
  const requests = await listRequesterRequests();
  const commentCounts = await countComments(requests.map(({ id }) => id));

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Acompanhamento</p>
        <h1>Minhas solicitações</h1>
        </div>
        <Link href="/catalog">Voltar ao catálogo</Link>
      </header>
      {requests.length === 0 ? (
        <p className="empty-state">Você ainda não abriu solicitações.</p>
      ) : (
        <ul className="content-list">
          {requests.map((request) => (
            <li key={request.id}>
              <h2>
                <Link href={`/requests/${request.id}`}>
                  {request.serviceNameSnapshot}
                </Link>
              </h2>
              <p><span className="status-pill">{statusLabels[request.status]}</span></p>
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
    </main>
  );
}
