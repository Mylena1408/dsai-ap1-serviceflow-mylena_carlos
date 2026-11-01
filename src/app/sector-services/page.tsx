import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/modules/auth";
import { listCategoriesForCatalog } from "@/modules/categories";
import { listDocumentRequirements } from "@/modules/document-requirements";
import { listServiceFields } from "@/modules/service-fields";
import { listServiceStages } from "@/modules/service-stages";
import { listSectorsForCatalog } from "@/modules/sectors";
import { listServices } from "@/modules/services";
import { requireCatalogEditor } from "@/server/authorization";
import { AuthenticationError, AuthorizationError } from "@/server/errors";
import { ServicesSection } from "@/app/(admin)/admin/_sections/services/services-section";
import { announcement } from "@/app/(admin)/admin/_shared/announcement";

type SectorServicesPageProps = {
  searchParams: Promise<{ error?: string; entity?: string; notice?: string }>;
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
    if (error instanceof AuthenticationError) redirect("/login");
    if (error instanceof AuthorizationError) redirect("/");
    throw error;
  }

  const [{ error, entity, notice }, services, categories, sectors, documentRequirements, serviceFields, serviceStages] =
    await Promise.all([
      searchParams,
      listServices(),
      listCategoriesForCatalog(),
      listSectorsForCatalog(),
      listDocumentRequirements(),
      listServiceFields(),
      listServiceStages(),
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
            serviceFields={serviceFields}
            serviceStages={serviceStages}
            services={services}
          />
        </div>
      </main>
    </>
  );
}
