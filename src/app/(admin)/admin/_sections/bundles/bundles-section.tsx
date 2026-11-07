import {
  BUNDLE_PROBLEM_LABELS,
  MAX_BUNDLE_DESCRIPTION_LENGTH,
  MAX_BUNDLE_NAME_LENGTH,
  MAX_BUNDLE_SERVICES,
  MIN_BUNDLE_SERVICES,
  availabilityText,
  serviceProblems,
  type BundleOverview,
  type BundleServiceState,
  type BundleView,
} from "@/modules/service-bundles";
import { createBundleAction, toggleBundleAction, updateBundleAction } from "./actions";

// "Pacotes" (SPEC 2026-11-07-operacao-e-automacao, 3.3 item 2): 2 to 5 services, in order, opened
// together by the requester. Only services without active document requirements may enter; a bundle
// whose services stop being so leaves the catalog, and this section says why.

/** "Troca de crachá · Infraestrutura" or, when it may not enter a bundle, with the reason. */
export function serviceOptionLabel(service: BundleServiceState): string {
  const problems = serviceProblems(service);
  const base = `${service.name} · ${service.sectorName}`;
  return problems.length === 0 ? base : `${base} (${problems.map((problem) => BUNDLE_PROBLEM_LABELS[problem]).join(", ")})`;
}

/** "Troca de crachá → Acesso ao sistema → Mesa e cadeira". */
export function bundleServicesText(bundle: Pick<BundleView, "serviceIds">, services: readonly BundleServiceState[]): string {
  const names = new Map(services.map((service) => [service.id, service.name]));
  return bundle.serviceIds.map((id) => names.get(id) ?? "(serviço removido)").join(" → ");
}

function BundleFields({ bundle, services }: { bundle?: BundleView; services: readonly BundleServiceState[] }) {
  return (
    <>
      <label>
        Nome
        <input defaultValue={bundle?.name} maxLength={MAX_BUNDLE_NAME_LENGTH} name="name" required />
      </label>
      <label>
        Descrição (opcional)
        <textarea defaultValue={bundle?.description ?? ""} maxLength={MAX_BUNDLE_DESCRIPTION_LENGTH} name="description" rows={2} />
      </label>
      <fieldset className="format-options">
        <legend>
          Serviços, na ordem (de {MIN_BUNDLE_SERVICES} a {MAX_BUNDLE_SERVICES})
        </legend>
        {Array.from({ length: MAX_BUNDLE_SERVICES }, (_, index) => (
          <label key={index}>
            Serviço {index + 1}
            <select defaultValue={bundle?.serviceIds[index] ?? ""} name="serviceIds" required={index < MIN_BUNDLE_SERVICES}>
              <option value="">{index < MIN_BUNDLE_SERVICES ? "Escolha um serviço" : "Nenhum"}</option>
              {services.map((service) => (
                <option disabled={serviceProblems(service).length > 0} key={service.id} value={service.id}>
                  {serviceOptionLabel(service)}
                </option>
              ))}
            </select>
          </label>
        ))}
      </fieldset>
    </>
  );
}

export function BundlesSection({ overview }: { overview: BundleOverview }) {
  const { bundles, services } = overview;

  return (
    <section className="admin-section" aria-labelledby="bundles-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Catálogo</p>
          <h2 id="bundles-heading">Pacotes</h2>
          <p className="section-description">
            Um pacote reúne serviços que costumam ser pedidos juntos, mesmo de setores diferentes. O solicitante preenche um formulário
            só, e cada serviço vira uma solicitação. Serviços que pedem documentos não entram em pacotes.
          </p>
        </div>
      </div>

      <form action={createBundleAction} aria-label="Novo pacote" className="create-form bundle-form">
        <BundleFields services={services} />
        <button type="submit">Criar pacote</button>
      </form>

      {bundles.length === 0 ? (
        <p>Nenhum pacote cadastrado.</p>
      ) : (
        <ul className="entity-list">
          {bundles.map((bundle) => {
            const outside = availabilityText(bundle.availability);
            return (
              <li className="entity-item" key={bundle.id}>
                <div className="entity-summary">
                  <strong>{bundle.name}</strong>
                  <span className={`status-badge${bundle.availability.openable ? "" : " is-inactive"}`}>
                    {!bundle.isActive ? "Inativo" : bundle.availability.openable ? "No catálogo" : "Fora do catálogo"}
                  </span>
                </div>
                <p>{bundleServicesText(bundle, services)}</p>
                {bundle.description ? <p className="section-description">{bundle.description}</p> : null}
                {bundle.isActive && outside ? <p className="metadata">Fora do catálogo por causa de: {outside}.</p> : null}
                <details>
                  <summary>Editar</summary>
                  <form action={updateBundleAction} aria-label={`Editar pacote ${bundle.name}`} className="create-form bundle-form">
                    <input name="id" type="hidden" value={bundle.id} />
                    <BundleFields bundle={bundle} services={services} />
                    <button type="submit">Salvar pacote</button>
                  </form>
                </details>
                <form action={toggleBundleAction} className="entity-actions">
                  <input name="id" type="hidden" value={bundle.id} />
                  <input name="isActive" type="hidden" value={bundle.isActive ? "false" : "true"} />
                  <button className={bundle.isActive ? "button-danger" : "button-secondary"} type="submit">
                    {bundle.isActive ? "Desativar" : "Reativar"}
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
