import { getDashboard } from "@/modules/reports";
import { DashboardView } from "@/app/_components/dashboard-view";
import { requireManagerPageAccess } from "../../page-access";

// "Painel do setor" (SPEC 2026-11-02-painel-relatorios, 5.1): only the manager's current sector.

type ManagerDashboardPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ManagerDashboardPage({ searchParams }: ManagerDashboardPageProps) {
  await requireManagerPageAccess();
  const { period, from, to } = await searchParams;
  const dashboard = await getDashboard({ period, from, to });

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Indicadores</p>
          <h1>Painel do setor</h1>
          <p>Números consolidados das solicitações do seu setor.</p>
        </div>
      </header>
      <DashboardView action="/approvals/dashboard" dashboard={dashboard} />
    </main>
  );
}
