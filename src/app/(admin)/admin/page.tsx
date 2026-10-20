import { redirect } from "next/navigation";
import Link from "next/link";
import { SignOutButton } from "@/modules/auth/components/sign-out-button";
import {
  listCategories,
} from "@/modules/categories";
import { AuthenticationError, AuthorizationError } from "@/server/errors";
import { requireConfigurationAdministrator } from "@/server/authorization";
import { listSectors } from "@/modules/sectors";
import { listServices } from "@/modules/services";
import { listUsers } from "@/modules/users";
import {
  MAX_ACTIVE_DOCUMENT_REQUIREMENTS,
  listDocumentRequirements,
} from "@/modules/document-requirements";
import { AdminCreateForm } from "./create-form";
import { AdminRecordEditor } from "./record-editor";
import { DocumentRequirementsEditor } from "./document-requirements-editor";
import {
  createCategoryAction,
  createDocumentRequirementAction,
  deactivateDocumentRequirementAction,
  moveDocumentRequirementAction,
  updateDocumentRequirementAction,
  createSectorAction,
  createServiceAction,
  createUserAction,
  toggleCategoryAction,
  toggleSectorAction,
  toggleServiceAction,
  toggleUserAction,
  updateCategoryAction,
  updateSectorAction,
  updateServiceAction,
  updateUserAction,
} from "./actions";

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

function announcement(error?: string, notice?: string): string | null {
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

  const [{ error, notice, section }, sectors, categories, users, services, documentRequirements] =
    await Promise.all([
      searchParams,
      listSectors(),
      listCategories(),
      listUsers(),
      listServices(),
      listDocumentRequirements(),
    ]);
  const message = announcement(error, notice);
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
        <section aria-labelledby="overview-heading" className="admin-overview">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Resumo da configuração</p>
              <h2 id="overview-heading">Visão geral</h2>
              <p className="section-description">Escolha um cadastro para consultar e gerenciar seus registros.</p>
            </div>
          </div>
          <div className="admin-overview-grid">
            {[
              { id: "users", label: "Usuários", count: users.length, detail: "Perfis e acessos" },
              { id: "sectors", label: "Setores", count: sectors.length, detail: "Equipes da organização" },
              { id: "categories", label: "Categorias", count: categories.length, detail: "Grupos do catálogo" },
              { id: "services", label: "Serviços", count: services.length, detail: "Opções disponíveis" },
            ].map((item) => (
              <Link
                className="admin-overview-card"
                href={`/admin?section=${item.id}`}
                key={item.id}
              >
                <span className="eyebrow">{item.label}</span>
                <strong>{item.count}</strong>
                <span>{item.detail}</span>
                <span className="admin-overview-link">Abrir cadastro <span aria-hidden="true">→</span></span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {selectedSection !== "overview" ? (
        <div className="admin-sections">
      {selectedSection === "sectors" ? (
        <section className="admin-section" aria-labelledby="sectors-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Estrutura organizacional</p>
            <h2 id="sectors-heading">Setores</h2>
            <p className="section-description">Organize as equipes responsáveis pelo atendimento.</p>
          </div>
        </div>
        <AdminCreateForm action={createSectorAction} submitLabel="Criar setor">
          <label>
            Novo setor
            <input name="name" required maxLength={200} />
          </label>
        </AdminCreateForm>
        <ul className="entity-list">
          {sectors.map((sector) => (
            <AdminRecordEditor
              key={sector.id}
              record={{ kind: "sector", ...sector }}
              section={selectedSection}
              toggleAction={toggleSectorAction}
              updateAction={updateSectorAction}
            />
          ))}
        </ul>
        </section>
      ) : null}

      {selectedSection === "categories" ? (
        <section className="admin-section" aria-labelledby="categories-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Catálogo</p>
            <h2 id="categories-heading">Categorias</h2>
            <p className="section-description">Agrupe serviços em categorias fáceis de encontrar.</p>
          </div>
        </div>
        <AdminCreateForm action={createCategoryAction} submitLabel="Criar categoria">
          <label>
            Nova categoria
            <input name="name" required maxLength={200} />
          </label>
        </AdminCreateForm>
        <ul className="entity-list">
          {categories.map((category) => (
            <AdminRecordEditor
              key={category.id}
              record={{ kind: "category", ...category }}
              section={selectedSection}
              toggleAction={toggleCategoryAction}
              updateAction={updateCategoryAction}
            />
          ))}
        </ul>
        </section>
      ) : null}

      {selectedSection === "users" ? (
        <section className="admin-section" aria-labelledby="users-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Acessos e equipes</p>
            <h2 id="users-heading">Usuários</h2>
            <p className="section-description">Gerencie perfis, acessos e a associação de atendentes aos setores.</p>
          </div>
        </div>
        <AdminCreateForm action={createUserAction} submitLabel="Criar usuário">
          <label>Nome<input name="name" required /></label>
          <label>E-mail<input name="email" type="email" required /></label>
          <label>Senha inicial<input name="password" type="password" required /></label>
          <label>
            Perfil
            <select name="role" defaultValue="REQUESTER" required>
              <option value="ADMIN">Administrador</option>
              <option value="REQUESTER">Solicitante</option>
              <option value="ATTENDANT">Atendente</option>
            </select>
          </label>
          <label>
            Setor da equipe
            <select name="sectorId" defaultValue="">
              <option value="">Selecione se for atendente</option>
              {sectors
                .filter((sector) => sector.isActive)
                .map((sector) => (
                  <option key={sector.id} value={sector.id}>{sector.name}</option>
                ))}
            </select>
            </label>
        </AdminCreateForm>
        <ul className="entity-list">
          {users.map((user) => (
            <AdminRecordEditor
              key={user.id}
              record={{ kind: "user", ...user }}
              sectors={sectors}
              section={selectedSection}
              toggleAction={toggleUserAction}
              updateAction={updateUserAction}
            />
          ))}
        </ul>
        </section>
      ) : null}

      {selectedSection === "services" ? (
        <section className="admin-section" aria-labelledby="services-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Oferta de serviços</p>
            <h2 id="services-heading">Serviços</h2>
            <p className="section-description">Configure o que as pessoas podem solicitar e qual equipe atende.</p>
          </div>
        </div>
        <AdminCreateForm action={createServiceAction} submitLabel="Criar serviço">
          <label>Nome<input name="name" required /></label>
          <label className="wide-field">Descrição<textarea name="description" required /></label>
          <label>
            Categoria
            <select name="categoryId" required defaultValue="">
              <option value="" disabled>Selecione</option>
              {categories.filter((category) => category.isActive).map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </label>
          <label>
            Setor
            <select name="sectorId" required defaultValue="">
              <option value="" disabled>Selecione</option>
              {sectors.filter((sector) => sector.isActive).map((sector) => (
                <option key={sector.id} value={sector.id}>{sector.name}</option>
              ))}
            </select>
          </label>
        </AdminCreateForm>
        <ul className="entity-list">
          {services.map((service) => (
            <AdminRecordEditor
              key={service.id}
              record={{
                kind: "service",
                id: service.id,
                name: service.name,
                description: service.description,
                categoryId: service.categoryId,
                sectorId: service.sectorId,
                isActive: service.isActive,
              }}
              categories={categories}
              sectors={sectors}
              section={selectedSection}
              toggleAction={toggleServiceAction}
              updateAction={updateServiceAction}
            >
              <DocumentRequirementsEditor
                createAction={createDocumentRequirementAction}
                deactivateAction={deactivateDocumentRequirementAction}
                maxActive={MAX_ACTIVE_DOCUMENT_REQUIREMENTS}
                moveAction={moveDocumentRequirementAction}
                requirements={documentRequirements
                  .filter((requirement) => requirement.serviceId === service.id)
                  .map((requirement) => ({
                    id: requirement.id,
                    name: requirement.name,
                    isRequired: requirement.isRequired,
                    acceptedFormats: requirement.acceptedFormats,
                    isActive: requirement.isActive,
                  }))}
                serviceId={service.id}
                updateAction={updateDocumentRequirementAction}
              />
            </AdminRecordEditor>
          ))}
        </ul>
        </section>
      ) : null}
        </div>
      ) : null}
    </main>
  );
}
