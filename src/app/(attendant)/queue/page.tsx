import Link from "next/link";
import { countComments } from "@/modules/comments";
import { effectiveAssigneeId, listAttendantQueue } from "@/modules/requests";
import { requireAttendantPageAccess } from "../page-access";
import { REQUEST_STATUS_LABELS } from "@/app/_components/request-status";

const statusLabels = REQUEST_STATUS_LABELS;

function commentLabel(count: number): string {
  return count === 1 ? "1 comentário" : `${count} comentários`;
}

export default async function AttendantQueuePage() {
  const actor = await requireAttendantPageAccess();
  const requests = await listAttendantQueue();
  const commentCounts = await countComments(requests.map(({ id }) => id));

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Atendimento</p>
          <h1>Fila do meu setor</h1>
          <p>Solicitações encaminhadas à equipe que você atende.</p>
        </div>
      </header>
      {requests.length === 0 ? (
        <p className="empty-state">Não há solicitações no setor.</p>
      ) : (
        <ul className="content-list">
          {requests.map((request) => (
            <li key={request.id}>
              <h2>
                <Link href={`/queue/${request.id}`}>
                  {request.serviceNameSnapshot}
                </Link>
              </h2>
              <p><span className="status-pill">{statusLabels[request.status]}</span></p>
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
    </main>
  );
}
