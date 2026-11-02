import type { AdminApiTokenRecord } from "@/modules/api-tokens";
import { ApiTokenList } from "@/app/_components/api-token-list";
import { revokeApiTokenAsAdminAction } from "./actions";

// "Acesso à API" of the administration (SPEC 2026-11-02-api-externa-webhooks, 5.1 and 5.8): every
// token with its owner, scope and dates, never the value; the administrator revokes any of them.

export function ApiTokensSection({ tokens }: { tokens: readonly AdminApiTokenRecord[] }) {
  return (
    <section className="admin-section" aria-labelledby="api-tokens-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Integrações</p>
          <h2 id="api-tokens-heading">Acesso à API</h2>
          <p className="section-description">
            Tokens criados por solicitantes, atendentes e gestores para outros sistemas. O token age com as permissões
            de quem o criou; revogar corta o acesso na chamada seguinte.
          </p>
        </div>
      </div>
      <ApiTokenList emptyText="Nenhum token criado." revokeAction={revokeApiTokenAsAdminAction} tokens={tokens} />
    </section>
  );
}
