import Link from "next/link";
import { groupPublishedServices, listPublishedServices } from "@/modules/services";
import { requireRequesterPageAccess } from "../page-access";

export default async function CatalogPage() {
  await requireRequesterPageAccess();
  const services = await listPublishedServices();
  const categories = groupPublishedServices(services);

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Descubra os serviços</p>
        <h1>Catálogo de serviços</h1>
        <p>Escolha um serviço para consultar os detalhes e abrir uma solicitação.</p>
        </div>
        <nav className="page-nav" aria-label="Navegação do solicitante">
          <Link href="/requests">Minhas solicitações</Link>
        </nav>
      </header>
      {categories.size === 0 ? (
        <p className="empty-state">Nenhum serviço está disponível no momento.</p>
      ) : (
        [...categories].map(([categoryName, categoryServices]) => (
          <section className="content-section" key={categoryName} aria-labelledby={`category-${categoryName}`}>
            <div className="section-heading">
              <div>
                <p className="eyebrow">Categoria</p>
                <h2 id={`category-${categoryName}`}>{categoryName}</h2>
              </div>
            </div>
            <ul className="service-grid">
              {categoryServices.map((service) => (
                <li className="service-card" key={service.id}>
                  <h3>
                    <Link href={`/catalog/${service.id}`}>{service.name}</Link>
                  </h3>
                  <p>{service.description}</p>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}
