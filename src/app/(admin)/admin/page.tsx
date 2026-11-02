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
import { listPermissionOverview } from "@/modules/permissions";
import { getEmailOverview } from "@/modules/notifications";
import { CategoriesSection } from "./_sections/categories/categories-section";
import { announcement } from "./_shared/announcement";
import { OverviewSection } from "./_sections/overview-section";
import { SectorsSection } from "./_sections/sectors/sectors-section";
import { ServicesSection } from "./_sections/services/services-section";
import { UsersSection } from "./_sections/users/users-section";
import { EmailsSection } from "./_sections/emails/emails-section";

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
  { id: "emails", label: "E-mails" },
] as const;

type AdminSection = (typeof adminSections)[number]["id"];

function selectedAdminSection(section?: string): AdminSection {
  return adminSections.find((item) => item.id === section)?.id ?? "overview";
}


// SPEC 2026-11-01-aprovacoes, 9: how many active managers each sector has.
function activeManagersBySector(users: Array<{ role: string; isActive: boolean; sectorId: string | null }>) {
  const counts = new Map<string, number>();
  for (const user of users) {
    if (user.role === "MANAGER" && user.isActive && user.sectorId) {
      counts.set(user.sectorId, (counts.get(user.sectorId) ?? 0) + 1);
    }
  }
  return counts;
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  try {
    await requireConfigurationAdministrator();
  } catch (error) {
    if (error instanceof AuthenticationError) redirect("/login");
    if (error instanceof AuthorizationError) redirect("/");
    throw error;
  }

  const [{ entity, error, notice, section }, sectors, categories, users, services, documentRequirements, serviceFields, serviceStages, permissions] =
    await Promise.all([
      searchParams,
      listSectors(),
      listCategories(),
      listUsers(),
      listServices(),
      listDocumentRequirements(),
      listServiceFields(),
      listServiceStages(),
      listPermissionOverview(),
    ]);
  const message = announcement(error, notice, entity);
  const selectedSection = selectedAdminSection(section);
  // SPEC 2026-11-01-notificacoes-email-preferencias, 5.5: read only when the section is open.
  const emailOverview = selectedSection === "emails" ? await getEmailOverview() : null;

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
        <UsersSection permissions={permissions} section={selectedSection} sectors={sectors} users={users} />
      ) : null}

      {selectedSection === "services" ? (
        <ServicesSection
          categories={categories}
          documentRequirements={documentRequirements}
          serviceFields={serviceFields}
          serviceStages={serviceStages}
          activeManagersBySector={activeManagersBySector(users)}
          section={selectedSection}
          sectors={sectors}
          services={services}
        />
      ) : null}

      {emailOverview ? <EmailsSection overview={emailOverview} /> : null}
        </div>
      ) : null}
    </main>
  );
}
