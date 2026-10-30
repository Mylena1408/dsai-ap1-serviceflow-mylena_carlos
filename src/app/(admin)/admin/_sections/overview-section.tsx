import Link from "next/link";

type OverviewSectionProps = {
  counts: { users: number; sectors: number; categories: number; services: number };
};

export function OverviewSection({ counts }: OverviewSectionProps) {
  return (
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
              { id: "users", label: "Usuários", count: counts.users, detail: "Perfis e acessos" },
              { id: "sectors", label: "Setores", count: counts.sectors, detail: "Equipes da organização" },
              { id: "categories", label: "Categorias", count: counts.categories, detail: "Grupos do catálogo" },
              { id: "services", label: "Serviços", count: counts.services, detail: "Opções disponíveis" },
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
  );
}
