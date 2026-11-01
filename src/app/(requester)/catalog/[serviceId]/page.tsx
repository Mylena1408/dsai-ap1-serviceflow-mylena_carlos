import Link from "next/link";
import { notFound } from "next/navigation";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_TOTAL_BYTES } from "@/modules/attachments";
import { listPublishedServiceRequirements } from "@/modules/document-requirements";
import { listPublishedServiceFields } from "@/modules/service-fields";
import { getPublishedService } from "@/modules/services";
import { NotFoundError } from "@/server/errors";
import { requireRequesterPageAccess } from "../../page-access";
import { createRequestAction } from "../../requests/actions";
import { RequestForm, type FieldErrorCode } from "./request-form";

type ServicePageProps = {
  params: Promise<{ serviceId: string }>;
  searchParams: Promise<{ error?: string; fields?: string }>;
};

const FIELD_ERROR_CODES = new Set<FieldErrorCode>([
  "required",
  "too_long",
  "line_break",
  "not_integer",
  "out_of_range",
  "invalid_date",
  "invalid_option",
  "invalid_choice",
]);

// "fields" lists "<fieldId>.<code>" pairs sent back by the opening action; anything that does not
// name an active field with a known code is ignored.
function parseFieldErrors(list: string | undefined, fieldIds: ReadonlySet<string>): Record<string, FieldErrorCode> {
  const errors: Record<string, FieldErrorCode> = {};

  for (const item of (list ?? "").split(",")) {
    const separator = item.lastIndexOf(".");
    const fieldId = item.slice(0, separator);
    const code = item.slice(separator + 1) as FieldErrorCode;
    if (separator > 0 && fieldIds.has(fieldId) && FIELD_ERROR_CODES.has(code)) errors[fieldId] = code;
  }

  return errors;
}

function errorMessage(error: string | undefined, hasDocuments: boolean): string | null {
  if (error === "fields") {
    return `Confira os campos indicados abaixo.${hasDocuments ? " Os arquivos precisam ser anexados novamente." : ""}`;
  }
  if (error === "fields-changed") {
    return "Os campos deste serviço mudaram enquanto você preenchia. Confira o formulário abaixo e envie novamente.";
  }
  if (error === "validation") return "Informe uma descrição válida, com até 10.000 caracteres.";
  if (error === "unavailable") return "Este serviço não está mais disponível para novas solicitações.";
  if (error === "access") return "Sua sessão não permite abrir esta solicitação.";
  if (error === "attachments") {
    return "Os documentos não foram aceitos. Anexe todos os obrigatórios, um arquivo por documento, nos formatos e tamanhos indicados. Se a lista de documentos mudou, confira o formulário abaixo e envie novamente.";
  }
  if (error === "documents-unavailable") {
    return "Não foi possível guardar os documentos agora. Nenhuma solicitação foi criada; tente novamente mais tarde.";
  }
  return null;
}

export default async function ServicePage({
  params,
  searchParams,
}: ServicePageProps) {
  await requireRequesterPageAccess();
  const [{ serviceId }, { error, fields: fieldErrorList }] = await Promise.all([params, searchParams]);
  let service;
  let requirements;
  let fields;

  try {
    service = await getPublishedService(serviceId);
    requirements = await listPublishedServiceRequirements(service.id);
    fields = await listPublishedServiceFields(service.id);
  } catch (caught) {
    if (caught instanceof NotFoundError) notFound();
    throw caught;
  }

  const message = errorMessage(error, requirements.length > 0);
  const fieldErrors = error === "fields" ? parseFieldErrors(fieldErrorList, new Set(fields.map(({ id }) => id))) : {};

  return (
    <main className="page-shell">
      <header className="detail-heading">
      <nav aria-label="Navegação do catálogo">
        <Link href="/catalog">Voltar ao catálogo</Link>
      </nav>
      </header>
      <article className="surface-card service-detail">
        <p className="eyebrow">Detalhes do serviço</p>
        <h1>{service.name}</h1>
        <p>{service.description}</p>
        <p>Categoria: {service.category.name}</p>
        <p>Setor responsável: {service.sector.name}</p>
      </article>
      {message ? <p className="feedback feedback-error" role="alert">{message}</p> : null}
      <section className="surface-card content-section" aria-labelledby="request-heading">
        <p className="eyebrow">Próximo passo</p>
        <h2 id="request-heading">Abrir solicitação</h2>
        <RequestForm
          action={createRequestAction}
          fieldErrors={fieldErrors}
          fields={fields.map(({ id, label, helpText, type, isRequired, options, minValue, maxValue }) => ({
            id,
            label,
            helpText,
            type,
            isRequired,
            options,
            minValue,
            maxValue,
          }))}
          maxFileBytes={MAX_ATTACHMENT_BYTES}
          maxTotalBytes={MAX_ATTACHMENTS_TOTAL_BYTES}
          requirements={requirements.map(({ id, name, isRequired, acceptedFormats }) => ({
            id,
            name,
            isRequired,
            acceptedFormats,
          }))}
          serviceId={service.id}
        />
      </section>
    </main>
  );
}
