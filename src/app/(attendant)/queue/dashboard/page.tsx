import { getAttendantDashboard } from "@/modules/reports";
import { AttendantDashboardView } from "@/app/_components/analytics-view";
import { requireAttendantPageAccess } from "../../page-access";
import { getMyTime } from "@/modules/time-entries";
import { MyTimeView } from "@/app/_components/my-time-view";

// "Meu painel" (SPEC 2026-11-06-analises-operacionais, 5.3): the attendant's current sector and
// own numbers; never the numbers of colleagues.

type AttendantDashboardPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AttendantDashboardPage({ searchParams }: AttendantDashboardPageProps) {
  await requireAttendantPageAccess();
  const { period, from, to } = await searchParams;
  const dashboard = await getAttendantDashboard({ period, from, to });
  // SPEC 2026-11-08-atendimento-dia-a-dia, 13.2 item 2: the same period as the rest of the page.
  const myTime = await getMyTime({ period, from, to });

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Indicadores</p>
          <h1>Meu painel</h1>
          <p>A fila do seu setor em números e o resultado do seu trabalho no período.</p>
        </div>
      </header>
      <AttendantDashboardView dashboard={dashboard} />
      <MyTimeView period={dashboard.period} time={myTime} />
    </main>
  );
}
