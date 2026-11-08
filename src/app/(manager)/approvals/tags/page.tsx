import { listSectorTags } from "@/modules/tags";
import { SectorTagsPanel } from "@/app/_components/sector-tags";
import { requireManagerPageAccess } from "../../page-access";

// The tags of the manager's sector (SPEC 2026-11-08-atendimento-dia-a-dia, 3.3 item 1).

type TagsPageProps = { searchParams: Promise<{ tag?: string }> };

export default async function TagsPage({ searchParams }: TagsPageProps) {
  await requireManagerPageAccess();
  const [{ tag }, sectors] = await Promise.all([searchParams, listSectorTags()]);

  return (
    <main className="page-shell">
      <header className="detail-heading">
        <p className="eyebrow">Setor</p>
        <h1>Etiquetas</h1>
      </header>
      <SectorTagsPanel area="approvals" message={tag} sectors={sectors} />
    </main>
  );
}
