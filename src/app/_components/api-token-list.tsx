import { API_TOKEN_SCOPE_LABELS, isApiTokenActive, type AdminApiTokenRecord, type ApiTokenRecord } from "@/modules/api-tokens";
import { ROLE_LABELS } from "@/shared/admin-labels";

// List of API tokens (SPEC 2026-11-02-api-externa-webhooks, 5.1 and 5.8): the person's own on
// "Acesso à API", every token in the administration. Never the value or the hash.

type RevokeAction = (formData: FormData) => Promise<never>;

function dateTime(value: Date) {
  return <time dateTime={value.toISOString()}>{value.toLocaleString("pt-BR")}</time>;
}

function situation(token: ApiTokenRecord, now: Date) {
  if (token.revokedAt) {
    return (
      <span>
        Revogado em {dateTime(token.revokedAt)}
        {token.revokedByName ? ` por ${token.revokedByName}` : ""}
      </span>
    );
  }
  return isApiTokenActive(token, now) ? <span>Válido até {dateTime(token.expiresAt)}</span> : <span>Expirou em {dateTime(token.expiresAt)}</span>;
}

export function ApiTokenList({
  tokens,
  revokeAction,
  now = new Date(),
  emptyText,
}: {
  tokens: ReadonlyArray<ApiTokenRecord | AdminApiTokenRecord>;
  revokeAction: RevokeAction;
  now?: Date;
  emptyText: string;
}) {
  if (tokens.length === 0) {
    return <p className="empty-state">{emptyText}</p>;
  }

  return (
    <ul className="entity-list api-token-list">
      {tokens.map((token) => {
        const active = isApiTokenActive(token, now);
        return (
          <li className="entity-item" key={token.id}>
            <div className="entity-record-content">
              <div className="entity-summary">
                <strong>{token.name}</strong>
                <span className={`status-badge${active ? "" : " is-inactive"}`}>
                  {token.revokedAt ? "Revogado" : active ? "Ativo" : "Expirado"}
                </span>
              </div>
              <div className="entity-details">
                {"owner" in token ? (
                  <span>
                    {token.owner.name} · {ROLE_LABELS[token.owner.role]}
                  </span>
                ) : null}
                <span>{API_TOKEN_SCOPE_LABELS[token.scope]}</span>
                <span>Termina em …{token.lastFour}</span>
                <span>Criado em {dateTime(token.createdAt)}</span>
                {situation(token, now)}
                <span>{token.lastUsedAt ? <>Último uso em {dateTime(token.lastUsedAt)}</> : "Nunca usado"}</span>
              </div>
            </div>
            {token.revokedAt ? null : (
              <form action={revokeAction} className="entity-actions">
                <input name="tokenId" type="hidden" value={token.id} />
                <button className="button-danger" type="submit">
                  Revogar
                </button>
              </form>
            )}
          </li>
        );
      })}
    </ul>
  );
}
