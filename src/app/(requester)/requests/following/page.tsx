import Link from "next/link";
import { listFollowedRequests } from "@/modules/requests";
import { REQUEST_STATUS_LABELS } from "@/app/_components/request-status";
import { followMessage } from "@/app/_components/request-followers";
import { requireRequesterPageAccess } from "../../page-access";

// "Que eu acompanho" (SPEC 2026-11-08-atendimento-dia-a-dia, 6.3 item 2; decision I14): the requests a colleague added
// the requester to, read only.

type FollowingPageProps = { searchParams: Promise<{ follow?: string }> };

export default async function FollowingPage({ searchParams }: FollowingPageProps) {
  await requireRequesterPageAccess();
  const [{ follow }, requests] = await Promise.all([searchParams, listFollowedRequests()]);
  const feedback = followMessage(follow);

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Acompanhamento</p>
          <h1>Que eu acompanho</h1>
          <p>Solicitações de colegas que incluíram você para acompanhar. Você lê e recebe os avisos, sem agir nelas.</p>
        </div>
        <Link href="/requests">Minhas solicitações</Link>
      </header>
      {feedback ? (
        <p className={`feedback${feedback.error ? " feedback-error" : ""}`} role={feedback.error ? "alert" : "status"}>
          {feedback.text}
        </p>
      ) : null}
      {requests.length === 0 ? (
        <p className="empty-state">Você não acompanha nenhuma solicitação de colega.</p>
      ) : (
        <ul aria-label="Solicitações que eu acompanho" className="content-list">
          {requests.map((request) => (
            <li className="surface-card" key={request.id}>
              <h2>
                <Link href={`/requests/following/${request.id}`}>{request.serviceNameSnapshot}</Link>
              </h2>
              <p>
                <span className="status-pill">{REQUEST_STATUS_LABELS[request.status]}</span>
              </p>
              <p className="metadata">
                Aberta em {request.createdAt.toLocaleDateString("pt-BR")} · Setor: {request.sectorNameSnapshot}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
