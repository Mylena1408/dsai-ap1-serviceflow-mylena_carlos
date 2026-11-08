import { RecurringSchedules } from "@/app/_components/recurring-schedules";
import { loadScheduleScreen, type ScheduleScreenQuery } from "@/app/_components/recurring-schedule-screen";
import { requireManagerPageAccess } from "../../page-access";

// Schedules of recurring requests for the services of the manager's sector (SPEC
// 2026-11-07-operacao-e-automacao, 5.3 items 1 and 4).

type RecurringPageProps = { searchParams: Promise<ScheduleScreenQuery> };

export default async function RecurringPage({ searchParams }: RecurringPageProps) {
  await requireManagerPageAccess();
  const screen = await loadScheduleScreen(await searchParams);

  return (
    <main className="page-shell">
      <header className="detail-heading">
        <p className="eyebrow">Setor</p>
        <h1>Agendas</h1>
      </header>
      <RecurringSchedules area="approvals" screen={screen} />
    </main>
  );
}
