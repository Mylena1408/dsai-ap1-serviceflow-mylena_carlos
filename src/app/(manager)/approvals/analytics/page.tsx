import { getAnalytics } from "@/modules/reports";
import { AnalyticsView } from "@/app/_components/analytics-view";
import { requireManagerPageAccess } from "../../page-access";

// "Análises" of the manager (SPEC 2026-11-06-analises-operacionais, 5.1): only the current sector;
// a sector in the URL is ignored by the use case.

type ManagerAnalyticsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ManagerAnalyticsPage({ searchParams }: ManagerAnalyticsPageProps) {
  await requireManagerPageAccess();
  const { period, from, to } = await searchParams;
  const analytics = await getAnalytics({ period, from, to });

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Indicadores</p>
          <h1>Análises do setor</h1>
          <p>Tendências, tempos de atendimento e a distribuição do trabalho da equipe do seu setor.</p>
        </div>
      </header>
      <AnalyticsView action="/approvals/analytics" analytics={analytics} />
    </main>
  );
}
