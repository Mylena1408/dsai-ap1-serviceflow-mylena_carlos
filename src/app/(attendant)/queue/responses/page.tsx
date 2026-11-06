import { MAX_CANNED_BODY_LENGTH, MAX_CANNED_TITLE_LENGTH, listSectorResponses, type CannedResponseRecord } from "@/modules/canned-responses";
import { NotFoundError } from "@/server/errors";
import { requireAttendantPageAccess } from "../../page-access";
import { createCannedResponseAction, setCannedResponseActiveAction, updateCannedResponseAction } from "./actions";

// "Respostas prontas" (SPEC 2026-11-06-respostas-prontas, 2 and 4): the responses of the
// attendant's sector, maintained by the sector's attendants.

const NOTICES: Record<string, string> = {
  created: "Resposta criada.",
  updated: "Resposta alterada.",
  deactivated: "Resposta desativada. Ela não aparece mais no comentário.",
  activated: "Resposta reativada.",
};

const ERRORS: Record<string, string> = {
  invalid: `Informe um título de até ${MAX_CANNED_TITLE_LENGTH} caracteres e um texto de até ${MAX_CANNED_BODY_LENGTH.toLocaleString("pt-BR")} caracteres.`,
  duplicate: "Já existe uma resposta ativa com esse título no setor.",
  missing: "Resposta não encontrada.",
};

type ResponsesPageProps = { searchParams: Promise<{ notice?: string; error?: string }> };

function ResponseFields({ response }: { response?: CannedResponseRecord }) {
  const suffix = response?.id ?? "new";
  return (
    <>
      <label htmlFor={`title-${suffix}`}>Título</label>
      <input id={`title-${suffix}`} name="title" required maxLength={MAX_CANNED_TITLE_LENGTH} defaultValue={response?.title} />
      <label htmlFor={`body-${suffix}`}>Texto</label>
      <textarea id={`body-${suffix}`} name="body" required maxLength={MAX_CANNED_BODY_LENGTH} rows={5} defaultValue={response?.body} />
    </>
  );
}

export default async function ResponsesPage({ searchParams }: ResponsesPageProps) {
  await requireAttendantPageAccess();
  const { notice, error } = await searchParams;
  let responses: CannedResponseRecord[] = [];
  let withoutSector = false;
  try {
    responses = await listSectorResponses();
  } catch (caught) {
    if (!(caught instanceof NotFoundError)) throw caught;
    withoutSector = true;
  }

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Atendimento</p>
          <h1>Respostas prontas</h1>
          <p>Textos do seu setor para inserir nos comentários. Você sempre revisa antes de enviar.</p>
        </div>
      </header>
      {notice && NOTICES[notice] ? (
        <p className="feedback" role="status">
          {NOTICES[notice]}
        </p>
      ) : null}
      {error && ERRORS[error] ? (
        <p className="feedback feedback-error" role="alert">
          {ERRORS[error]}
        </p>
      ) : null}
      {withoutSector ? (
        <p className="empty-state">Você não está ligado a um setor, então não há respostas para mostrar.</p>
      ) : (
        <>
          <section className="surface-card" aria-labelledby="new-response">
            <h2 id="new-response">Nova resposta</h2>
            <p className="metadata">
              Campos substituídos ao inserir: <code>{"{{solicitante}}"}</code> (primeiro nome), <code>{"{{servico}}"}</code>,{" "}
              <code>{"{{codigo}}"}</code> e <code>{"{{atendente}}"}</code>.
            </p>
            <form action={createCannedResponseAction} className="request-form">
              <ResponseFields />
              <button type="submit">Criar resposta</button>
            </form>
          </section>
          <section className="surface-card" aria-labelledby="sector-responses">
            <h2 id="sector-responses">Respostas do setor</h2>
            {responses.length === 0 ? (
              <p className="metadata">O setor ainda não tem respostas prontas.</p>
            ) : (
              <ul className="content-list">
                {responses.map((response) => (
                  <li key={response.id} className="entity-item">
                    <h3>
                      {response.title} {response.isActive ? null : <span className="status-pill">Inativa</span>}
                    </h3>
                    <p className="request-description">{response.body}</p>
                    <p className="metadata">
                      Criada por {response.createdByName} · alterada por {response.updatedByName} em{" "}
                      {response.updatedAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}
                    </p>
                    <details>
                      <summary>Editar</summary>
                      <form action={updateCannedResponseAction} className="request-form">
                        <input type="hidden" name="id" value={response.id} />
                        <ResponseFields response={response} />
                        <button type="submit">Salvar alterações</button>
                      </form>
                    </details>
                    <form action={setCannedResponseActiveAction}>
                      <input type="hidden" name="id" value={response.id} />
                      <input type="hidden" name="active" value={response.isActive ? "false" : "true"} />
                      <button className="button-secondary" type="submit">
                        {response.isActive ? "Desativar" : "Reativar"}
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
