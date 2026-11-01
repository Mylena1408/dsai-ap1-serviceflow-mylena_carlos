import Link from "next/link";
import { listManagerApprovals } from "@/modules/requests";
import { RequestApprovalLabel } from "@/app/_components/request-approval";
import { REQUEST_STATUS_LABELS } from "@/app/_components/request-status";
import { actorHasPermission } from "@/server/authorization";
import { requireManagerPageAccess } from "../page-access";

type ApprovalsPageProps = {
  searchParams: Promise<{ filter?: string }>;
};

// Manager home (SPEC 2026-11-01-aprovacoes, 5.7, decision A4): requests of the sector that
// require approval, pending ones by default; "Todas" also lists the decided ones.
export default async function ApprovalsPage({ searchParams }: ApprovalsPageProps) {
  const actor = await requireManagerPageAccess();
  const { filter } = await searchParams;
  // SPEC 2026-11-01-permissoes-configuraveis, 5.3.2: "Todas do setor" only with the permission.
  const sectorReader = await actorHasPermission(actor, "SECTOR_REQUESTS_READ");
  const view = filter === "sector" && sectorReader ? "sector" : filter === "all" ? "all" : "pending";
  const showAll = view !== "pending";
  const requests = await listManagerApprovals(view);

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
        <Link aria-current={view === "pending" ? "page" : undefined} href="/approvals">Pendentes</Link>
        <Link aria-current={view === "all" ? "page" : undefined} href="/approvals?filter=all">Todas</Link>
        {sectorReader ? (
          <Link aria-current={view === "sector" ? "page" : undefined} href="/approvals?filter=sector">
            Todas do setor
          </Link>
        ) : null}
      </nav>
      {requests.length === 0 ? (
        <p className="empty-state">
          {view === "sector"
            ? "Nenhuma solicitação no setor."
            : showAll
              ? "Nenhuma solicitação do setor exige aprovação."
              : "Nenhuma aprovação pendente."}
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
