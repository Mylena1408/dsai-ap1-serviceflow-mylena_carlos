import { listAttendantAbsences } from "@/modules/absences";
import { AttendantAbsences } from "@/app/_components/attendant-absences";
import { requireManagerPageAccess } from "../../page-access";

// Absences of the attendants of the manager's sector (SPEC 2026-11-07-operacao-e-automacao, 4.3 item 7),
// on a page of its own so the manager's own absences page stays as it was.

type TeamAbsencesPageProps = { searchParams: Promise<{ absence?: string }> };

export default async function TeamAbsencesPage({ searchParams }: TeamAbsencesPageProps) {
  await requireManagerPageAccess();
  const [{ absence }, overview] = await Promise.all([searchParams, listAttendantAbsences()]);

  return (
    <main className="page-shell">
      <header className="detail-heading">
        <p className="eyebrow">Equipe</p>
        <h1>Afastamentos da equipe</h1>
      </header>
      <AttendantAbsences area="approvals" message={absence} overview={overview} />
    </main>
  );
}
