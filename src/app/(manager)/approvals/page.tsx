import { requireManagerPageAccess } from "../page-access";

// Manager home (SPEC 2026-11-01-aprovacoes, 5.7). The list of approvals of the sector comes
// with SF-085, once requests can be decided (SF-084).
export default async function ApprovalsPage() {
  await requireManagerPageAccess();

  return (
    <main className="page-shell">
      <header className="page-header">
        <div className="page-intro">
          <p className="eyebrow">Gestão do setor</p>
          <h1>Aprovações</h1>
          <p>Solicitações do seu setor que precisam da sua aprovação antes do atendimento.</p>
        </div>
      </header>
    </main>
  );
}
