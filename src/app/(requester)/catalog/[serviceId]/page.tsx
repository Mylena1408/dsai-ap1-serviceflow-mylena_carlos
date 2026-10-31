import Link from "next/link";
import { notFound } from "next/navigation";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_TOTAL_BYTES } from "@/modules/attachments";
import { listPublishedServiceRequirements } from "@/modules/document-requirements";
import { getPublishedService } from "@/modules/services";
import { NotFoundError } from "@/server/errors";
import { requireRequesterPageAccess } from "../../page-access";
import { createRequestAction } from "../../requests/actions";
import { DocumentFields } from "./document-fields";

type ServicePageProps = {
  params: Promise<{ serviceId: string }>;
  searchParams: Promise<{ error?: string }>;
};

function errorMessage(error?: string): string | null {
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
  const [{ serviceId }, { error }] = await Promise.all([params, searchParams]);
  let service;
  let requirements;

  try {
    service = await getPublishedService(serviceId);
    requirements = await listPublishedServiceRequirements(service.id);
  } catch (caught) {
    if (caught instanceof NotFoundError) notFound();
    throw caught;
  }

  const message = errorMessage(error);

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
        <form action={createRequestAction} className="request-form">
          <input type="hidden" name="serviceId" value={service.id} />
          <label htmlFor="request-description">Descreva o que você precisa</label>
          <textarea
            id="request-description"
            name="description"
            required
            maxLength={10_000}
            rows={6}
          />
          <p>Máximo de 10.000 caracteres.</p>
          {requirements.length > 0 ? (
            <DocumentFields
              requirements={requirements.map(({ id, name, isRequired, acceptedFormats }) => ({
                id,
                name,
                isRequired,
                acceptedFormats,
              }))}
              maxFileBytes={MAX_ATTACHMENT_BYTES}
              maxTotalBytes={MAX_ATTACHMENTS_TOTAL_BYTES}
            />
          ) : null}
          <button type="submit">Enviar solicitação</button>
        </form>
      </section>
    </main>
  );
}
