import { listAttendantAbsences } from "@/modules/absences";
import { AttendantAbsences } from "@/app/_components/attendant-absences";
import { requireAttendantPageAccess } from "../../page-access";

// The attendant's own absences (SPEC 2026-11-07-operacao-e-automacao, 4.3 item 7).

type AbsencesPageProps = { searchParams: Promise<{ absence?: string }> };

export default async function AttendantAbsencesPage({ searchParams }: AbsencesPageProps) {
  await requireAttendantPageAccess();
  const [{ absence }, overview] = await Promise.all([searchParams, listAttendantAbsences()]);

  return (
    <main className="page-shell">
      <header className="detail-heading">
        <p className="eyebrow">Fila</p>
        <h1>Minhas ausências</h1>
      </header>
      <AttendantAbsences area="queue" message={absence} overview={overview} />
    </main>
  );
}
