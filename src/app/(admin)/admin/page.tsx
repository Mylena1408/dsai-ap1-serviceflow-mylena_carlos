import { redirect } from "next/navigation";
import Link from "next/link";
import { SignOutButton } from "@/modules/auth";
import {
  listCategories,
} from "@/modules/categories";
import { AuthenticationError, AuthorizationError } from "@/server/errors";
import { requireConfigurationAdministrator } from "@/server/authorization";
import { listSectors } from "@/modules/sectors";
import { listServices } from "@/modules/services";
import { listUsers } from "@/modules/users";
import { listDocumentRequirements } from "@/modules/document-requirements";
import { listServiceFields } from "@/modules/service-fields";
import { listServiceStages } from "@/modules/service-stages";
import { CategoriesSection } from "./_sections/categories/categories-section";
import { OverviewSection } from "./_sections/overview-section";
import { SectorsSection } from "./_sections/sectors/sectors-section";
import { ServicesSection } from "./_sections/services/services-section";
import { UsersSection } from "./_sections/users/users-section";

type AdminPageProps = {
  searchParams: Promise<{
    error?: string;
    entity?: string;
    notice?: string;
    section?: string;
  }>;
};

const adminSections = [
  { id: "overview", label: "Visão geral" },
  { id: "users", label: "Usuários" },
  { id: "sectors", label: "Setores" },
  { id: "categories", label: "Categorias" },
  { id: "services", label: "Serviços" },
] as const;

type AdminSection = (typeof adminSections)[number]["id"];

function selectedAdminSection(section?: string): AdminSection {
  return adminSections.find((item) => item.id === section)?.id ?? "overview";
}

function announcement(error?: string, notice?: string, entity?: string): string | null {
  // Reactivating a custom field fails on the limit or on a repeated label (SPEC 2026-11-01-campos-personalizados, 5.1).
  if (error === "dependency" && entity === "serviceFields") {
    return "Não foi possível concluir: o serviço já tem o limite de campos ativos ou outro campo ativo usa o mesmo rótulo.";
  }
  // Reactivating a stage fails on the limit or on a repeated name (SPEC 2026-11-01-fluxos-configuraveis, 5.1).
  if (error === "dependency" && entity === "serviceStages") {
    return "Não foi possível concluir: o serviço já tem o limite de etapas ativas ou outra etapa ativa usa o mesmo nome.";
  }
  if (error === "dependency") {
    return "A operação não pode ser concluída enquanto existirem dependências ativas ou solicitações pendentes.";
  }
  if (error === "validation") {
    return "Confira os campos: há valores ausentes ou inválidos.";
  }
  if (error === "missing") {
    return "O registro não existe mais. Atualize a página e tente novamente.";
  }
  if (error === "access") {
    return "Sua sessão não tem permissão para essa operação.";
  }
  if (error === "unexpected") {
    return "Não foi possível concluir a operação. Tente novamente.";
  }
  if (notice === "created") return "Registro criado.";
  if (notice === "updated") return "Alterações salvas.";
  if (notice === "status") return "Estado atualizado.";
  return null;
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  try {
    await requireConfigurationAdministrator();
  } catch (error) {
    if (error instanceof AuthenticationError) redirect("/login");
    if (error instanceof AuthorizationError) redirect("/");
    throw error;
  }

  const [{ entity, error, notice, section }, sectors, categories, users, services, documentRequirements, serviceFields, serviceStages] =
    await Promise.all([
      searchParams,
      listSectors(),
      listCategories(),
      listUsers(),
      listServices(),
      listDocumentRequirements(),
      listServiceFields(),
      listServiceStages(),
    ]);
  const message = announcement(error, notice, entity);
  const selectedSection = selectedAdminSection(section);

  return (
    <main className="page-shell">
      <header className="page-header">
        <div className="page-intro">
          <p className="eyebrow">Espaço de trabalho</p>
          <h1>Administração</h1>
          <p>Gerencie usuários, setores, categorias e serviços.</p>
        </div>
        <div className="page-nav">
          <Link className="button-link-secondary" href="/account/password">
            Alterar senha
          </Link>
          <SignOutButton />
        </div>
      </header>
      <nav aria-label="Seções administrativas" className="admin-navigation">
        {adminSections.map((item) => (
          <Link
            aria-current={selectedSection === item.id ? "page" : undefined}
            className={`admin-navigation-link${selectedSection === item.id ? " is-selected" : ""}`}
            href={`/admin?section=${item.id}`}
            key={item.id}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {message ? (
        <p
          className={`feedback${error ? " feedback-error" : ""}`}
          role={error ? "alert" : "status"}
          aria-live="polite"
        >
          {message}
        </p>
      ) : null}

      {selectedSection === "overview" ? (
        <OverviewSection
          counts={{
            users: users.length,
            sectors: sectors.length,
            categories: categories.length,
            services: services.length,
          }}
        />
      ) : null}

      {selectedSection !== "overview" ? (
        <div className="admin-sections">
      {selectedSection === "sectors" ? (
        <SectorsSection section={selectedSection} sectors={sectors} />
      ) : null}

      {selectedSection === "categories" ? (
        <CategoriesSection categories={categories} section={selectedSection} />
      ) : null}

      {selectedSection === "users" ? (
        <UsersSection section={selectedSection} sectors={sectors} users={users} />
      ) : null}

      {selectedSection === "services" ? (
        <ServicesSection
          categories={categories}
          documentRequirements={documentRequirements}
          serviceFields={serviceFields}
          serviceStages={serviceStages}
          section={selectedSection}
          sectors={sectors}
          services={services}
        />
      ) : null}
        </div>
      ) : null}
    </main>
  );
}
