import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/modules/auth";
import { listCategoriesForCatalog } from "@/modules/categories";
import { listDocumentRequirements } from "@/modules/document-requirements";
import { listServiceFields } from "@/modules/service-fields";
import { listServiceStages } from "@/modules/service-stages";
import { listApprovalSectorChoices, listSectorsForCatalog } from "@/modules/sectors";
import { listServices } from "@/modules/services";
import { requireCatalogEditor } from "@/server/authorization";
import { listArticlesForEditor } from "@/modules/knowledge";
import { KnowledgeEditor } from "@/app/_components/knowledge-editor";
import { AuthenticationError, AuthorizationError } from "@/server/errors";
import { ServicesSection } from "@/app/(admin)/admin/_sections/services/services-section";
import { announcement } from "@/app/(admin)/admin/_shared/announcement";

type SectorServicesPageProps = {
  searchParams: Promise<{ error?: string; entity?: string; notice?: string; knowledge?: string }>;
};

// Services of the own sector for holders of "Gerir serviços do setor" (SPEC
// 2026-11-01-permissoes-configuraveis, 5.3.1): the same forms as the administration, limited by
// the server to the holder's sector.
export default async function SectorServicesPage({ searchParams }: SectorServicesPageProps) {
  let home: string;

  try {
    const editor = await requireCatalogEditor();
    if (editor.sectorId === null) redirect("/admin?section=services");
    home = editor.actor.role === "MANAGER" ? "/approvals" : "/queue";
  } catch (error) {
    if (error instanceof AuthenticationError) redirect("/");
    if (error instanceof AuthorizationError) redirect("/");
    throw error;
  }

  const [{ error, entity, notice, knowledge }, services, categories, sectors, documentRequirements, serviceFields, serviceStages, knowledgeServices, approvalSectors] =
    await Promise.all([
      searchParams,
      listServices(),
      listCategoriesForCatalog(),
      listSectorsForCatalog(),
      listDocumentRequirements(),
      listServiceFields(),
      listServiceStages(),
      // SPEC 2026-11-06-base-conhecimento, 2.2: the sector's services only.
      listArticlesForEditor(),
      // SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.1 (decision G19).
      listApprovalSectorChoices(),
    ]);
  const message = announcement(error, notice, entity);

  return (
    <>
      <header className="app-topbar">
        <Link className="brand-link" href={home}>
          <span className="brand-mark" aria-hidden="true">S</span>
          ServiceFlow
        </Link>
        <nav aria-label="Navegação principal">
          <Link href={home}>Voltar à minha área</Link>
          <Link href="/account/data">Meus dados</Link>
          <Link href="/account/api-tokens">Acesso à API</Link>
          <Link href="/account/password">Alterar senha</Link>
        </nav>
        <SignOutButton />
      </header>
      <main className="page-shell">
        <header className="page-header">
          <div className="page-intro">
            <p className="eyebrow">Permissão adicional</p>
            <h1>Serviços do setor</h1>
            <p>Configure os serviços do seu setor: dados, prazo, aprovação, documentos, campos e etapas.</p>
          </div>
        </header>
        {message ? (
          <p className={`feedback${error ? " feedback-error" : ""}`} role={error ? "alert" : "status"} aria-live="polite">
            {message}
          </p>
        ) : null}
        <div className="admin-sections">
          <ServicesSection
            categories={categories}
            documentRequirements={documentRequirements}
            section="sector-services"
            sectors={sectors}
            approvalSectors={approvalSectors}
            serviceFields={serviceFields}
            serviceStages={serviceStages}
            services={services}
          />
          <KnowledgeEditor services={knowledgeServices} returnTo="/sector-services" notice={knowledge} />
        </div>
      </main>
    </>
  );
}
