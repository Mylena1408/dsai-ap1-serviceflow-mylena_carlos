import type { ConfigurationExportCheck } from "@/modules/configuration";
import { ConfigurationImport } from "./configuration-import";

// "Configuração portátil" in the administration (SPEC 2026-11-07-operacao-e-automacao, part D): export the
// organization's configuration to a file, and import such a file with a preview before applying.

function sizeText(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

export function ConfigurationSection({ check }: { check: ConfigurationExportCheck }) {
  return (
    <>
      <section className="surface-card content-section" aria-labelledby="configuration-export-heading">
        <h2 id="configuration-export-heading">Exportar a configuração</h2>
        <p className="section-description">
          Um arquivo JSON com setores, categorias, serviços (com campos, documentos, etapas e artigos), regras de escalonamento, respostas prontas,
          papéis, calendário, feriados e pacotes, ativos e inativos. Não leva pessoas, senhas, tokens, webhooks nem solicitações; as pessoas citadas
          vão só pelo e-mail.
        </p>
        <p>Tamanho previsto: {sizeText(check.bytes)}.</p>
        {check.repeated.length > 0 || check.tooLarge ? (
          <div className="feedback feedback-error" role="alert">
            {check.tooLarge ? <p>O arquivo passará de 2 MB e não poderá ser importado.</p> : null}
            {check.repeated.length > 0 ? (
              <>
                <p>Estes nomes se repetem e impedirão a importação do arquivo; renomeie um de cada antes de exportar:</p>
                <ul aria-label="Nomes repetidos">
                  {check.repeated.map((entry) => (
                    <li key={entry}>{entry}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}
        {/* A download, as "Meus dados" and the CSV report do it; the export enters the audit trail. */}
        <form action="/api/configuration/export" method="get">
          <button type="submit">Exportar configuração</button>
        </form>
      </section>

      <section className="surface-card content-section" aria-labelledby="configuration-import-heading">
        <h2 id="configuration-import-heading">Importar uma configuração</h2>
        <p className="section-description">
          Envie um arquivo exportado de outro ambiente. A prévia mostra o que é novo, o que muda e o que fica igual, e nada é gravado até você
          aplicar. Um arquivo com qualquer problema é recusado inteiro.
        </p>
        <ConfigurationImport />
      </section>
    </>
  );
}
