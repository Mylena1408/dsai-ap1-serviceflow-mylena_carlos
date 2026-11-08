import { listServiceChecklists } from "@/modules/checklists";
import { ServiceChecklistsPanel } from "@/app/_components/service-checklists";
import { requireManagerPageAccess } from "../../page-access";

// The checklist models of the manager's sector's services (SPEC 2026-11-08-atendimento-dia-a-dia, 4.1 item 1).

type ChecklistsPageProps = { searchParams: Promise<{ checklist?: string; open?: string }> };

export default async function ChecklistsPage({ searchParams }: ChecklistsPageProps) {
  await requireManagerPageAccess();
  const [{ checklist, open }, services] = await Promise.all([searchParams, listServiceChecklists()]);

  return (
    <main className="page-shell">
      <header className="detail-heading">
        <p className="eyebrow">Setor</p>
        <h1>Checklists</h1>
      </header>
      <ServiceChecklistsPanel area="approvals" message={checklist} open={open} services={services} />
    </main>
  );
}
