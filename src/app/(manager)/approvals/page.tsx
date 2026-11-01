import Link from "next/link";
import { listManagerApprovals } from "@/modules/requests";
import { RequestApprovalLabel } from "@/app/_components/request-approval";
import { REQUEST_STATUS_LABELS } from "@/app/_components/request-status";
import { requireManagerPageAccess } from "../page-access";

type ApprovalsPageProps = {
  searchParams: Promise<{ filter?: string }>;
};

// Manager home (SPEC 2026-11-01-aprovacoes, 5.7, decision A4): requests of the sector that
// require approval, pending ones by default; "Todas" also lists the decided ones.
export default async function ApprovalsPage({ searchParams }: ApprovalsPageProps) {
  await requireManagerPageAccess();
  const { filter } = await searchParams;
  const showAll = filter === "all";
  const requests = await listManagerApprovals(showAll ? "all" : "pending");

  return (
    <main className="page-shell">
      <header className="page-header">
        <div className="page-intro">
          <p className="eyebrow">Gestão do setor</p>
          <h1>Aprovações</h1>
          <p>Solicitações do seu setor que precisam da sua aprovação antes do atendimento.</p>
        </div>
      </header>
      <nav aria-label="Filtro das aprovações" className="filter-links">
        <Link aria-current={showAll ? undefined : "page"} href="/approvals">Pendentes</Link>
        <Link aria-current={showAll ? "page" : undefined} href="/approvals?filter=all">Todas</Link>
      </nav>
      {requests.length === 0 ? (
        <p className="empty-state">
          {showAll ? "Nenhuma solicitação do setor exige aprovação." : "Nenhuma aprovação pendente."}
        </p>
      ) : (
        <ul className="content-list">
          {requests.map((request) => (
            <li key={request.id}>
              <h2>
                <Link href={`/approvals/${request.id}`}>{request.serviceNameSnapshot}</Link>
              </h2>
              <p>
                <span className="status-pill">{REQUEST_STATUS_LABELS[request.status]}</span>{" "}
                <RequestApprovalLabel request={request} />
              </p>
              <p>{request.description}</p>
              <p className="metadata">
                Aberta em{" "}
                <time dateTime={request.createdAt.toISOString()}>{request.createdAt.toLocaleString("pt-BR")}</time>
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
