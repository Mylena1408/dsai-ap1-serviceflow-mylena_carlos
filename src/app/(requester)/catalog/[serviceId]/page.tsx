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
import type { FieldValueErrorCode } from "@/modules/service-fields";
import { listPublishedArticles } from "@/modules/knowledge";
import { KnowledgeArticles } from "@/app/_components/knowledge-editor";

type ServicePageProps = {
  params: Promise<{ serviceId: string }>;
  searchParams: Promise<{ error?: string; fields?: string }>;
};

// A record with every code, so a code added to FieldErrorCode without an entry here fails to compile
// (the codes of SPEC 2026-11-06-aprofundamento-configurabilidade were missing from the old list).
const KNOWN_FIELD_ERROR_CODES: Record<FieldErrorCode, true> = {
  required: true,
  too_long: true,
  line_break: true,
  not_integer: true,
  out_of_range: true,
  invalid_date: true,
  invalid_option: true,
  invalid_choice: true,
  not_decimal: true,
  too_many_decimals: true,
  invalid_email: true,
  invalid_phone: true,
  invalid_cpf: true,
  invalid_cnpj: true,
  invalid_cep: true,
};
const FIELD_ERROR_CODES = new Set(Object.keys(KNOWN_FIELD_ERROR_CODES));

// The form's codes are the domain's codes, in both directions.
type SameCodes = [FieldValueErrorCode] extends [FieldErrorCode] ? ([FieldErrorCode] extends [FieldValueErrorCode] ? true : never) : never;
const formCodesMatchDomain: SameCodes = true;
void formCodesMatchDomain;

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
  let articles;

  try {
    service = await getPublishedService(serviceId);
    requirements = await listPublishedServiceRequirements(service.id);
    fields = await listPublishedServiceFields(service.id);
    // SPEC 2026-11-06-base-conhecimento, 4.2.
    articles = await listPublishedArticles(service.id);
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
      <KnowledgeArticles articles={articles} />
      {message ? <p className="feedback feedback-error" role="alert">{message}</p> : null}
      <section className="surface-card content-section" aria-labelledby="request-heading">
        <p className="eyebrow">Próximo passo</p>
        <h2 id="request-heading">Abrir solicitação</h2>
        <RequestForm
          action={createRequestAction}
          fieldErrors={fieldErrors}
          fields={fields.map(({ id, label, helpText, type, isRequired, options, minValue, maxValue, decimalPlaces, minDecimal, maxDecimal, conditionFieldId, conditionValue }) => ({
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
