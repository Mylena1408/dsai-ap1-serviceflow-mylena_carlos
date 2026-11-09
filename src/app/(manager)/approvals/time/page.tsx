import { getTimeReport } from "@/modules/time-entries";
import { TimeReportView } from "@/app/_components/time-report-view";
import { requireManagerPageAccess } from "../../page-access";

// The manager's time report (SPEC 2026-11-08-atendimento-dia-a-dia, 5.3 item 4): only the current sector; a sector
// in the URL is ignored by the use case.

type ManagerTimePageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ManagerTimePage({ searchParams }: ManagerTimePageProps) {
  await requireManagerPageAccess();
  const { period, from, to } = await searchParams;
  const report = await getTimeReport({ period, from, to });

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Indicadores</p>
          <h1>Horas do setor</h1>
          <p>As horas que a equipe lançou nas solicitações do setor, por atendente e por serviço.</p>
        </div>
      </header>
      <TimeReportView action="/approvals/time" report={report} />
    </main>
  );
}
