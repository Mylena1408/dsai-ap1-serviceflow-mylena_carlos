import Link from "next/link";
import { notFound } from "next/navigation";
import { getCatalogBundle } from "@/modules/service-bundles";
import { listPublishedServiceFields } from "@/modules/service-fields";
import { NotFoundError } from "@/server/errors";
import { requireRequesterPageAccess } from "../../../page-access";
import { openBundleAction } from "../actions";
import { BundleForm, type BundleSection } from "./bundle-form";
import { parseFieldErrors } from "../../[serviceId]/field-errors";
import { bundleErrorMessage } from "./bundle-messages";

// A bundle of the catalog (SPEC 2026-11-07-operacao-e-automacao, 3.3 item 3): the services it opens,
// in order, and one form for all of them.

type BundlePageProps = {
  params: Promise<{ bundleId: string }>;
  searchParams: Promise<{ error?: string; fields?: string }>;
};

export default async function BundlePage({ params, searchParams }: BundlePageProps) {
  await requireRequesterPageAccess();
  const [{ bundleId }, { error, fields: fieldErrorList }] = await Promise.all([params, searchParams]);
  let bundle;
  let sections: BundleSection[];

  try {
    bundle = await getCatalogBundle(bundleId);
    sections = await Promise.all(
      bundle.services.map(async (service) => ({
        serviceId: service.id,
        serviceName: service.name,
        sectorName: service.sectorName,
        fields: (await listPublishedServiceFields(service.id)).map(
          ({ id, label, helpText, type, isRequired, options, minValue, maxValue, decimalPlaces, minDecimal, maxDecimal, conditionFieldId, conditionValue }) => ({
            id,
            label,
            helpText,
            type,
            isRequired,
            options,
            minValue,
            maxValue,
            decimalPlaces,
            minDecimal,
            maxDecimal,
            conditionFieldId,
            conditionValue,
          }),
        ),
      })),
    );
  } catch (caught) {
    if (caught instanceof NotFoundError) notFound();
    throw caught;
  }

  const message = bundleErrorMessage(error);
  const fieldIds = new Set(sections.flatMap(({ fields }) => fields.map(({ id }) => id)));
  const fieldErrors = error === "fields" ? parseFieldErrors(fieldErrorList, fieldIds) : {};

  return (
    <main className="page-shell">
      <header className="detail-heading">
        <nav aria-label="Navegação do catálogo">
          <Link href="/catalog">Voltar ao catálogo</Link>
        </nav>
      </header>
      <article className="surface-card service-detail">
        <p className="eyebrow">Pacote de serviços</p>
        <h1>{bundle.name}</h1>
        {bundle.description ? <p>{bundle.description}</p> : null}
        <p>Ao enviar, cada serviço abaixo vira uma solicitação, acompanhada pelo setor responsável:</p>
        <ol>
          {bundle.services.map((service) => (
            <li key={service.id}>
              {service.name} · {service.sectorName}
            </li>
          ))}
        </ol>
      </article>
      {message ? (
        <p className="feedback feedback-error" role="alert">
          {message}
        </p>
      ) : null}
      <section className="surface-card content-section" aria-labelledby="bundle-request-heading">
        <p className="eyebrow">Próximo passo</p>
        <h2 id="bundle-request-heading">Abrir o pacote</h2>
        <BundleForm action={openBundleAction} bundleId={bundle.id} fieldErrors={fieldErrors} sections={sections} />
      </section>
    </main>
  );
}
