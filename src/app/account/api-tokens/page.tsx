import Link from "next/link";
import { redirect } from "next/navigation";
import { API_CALLS_PER_MINUTE, MAX_ACTIVE_API_TOKENS, listOwnApiTokens } from "@/modules/api-tokens";
import { SignOutButton } from "@/modules/auth";
import { requireCurrentActor, type AuthorizationActor } from "@/server/authorization";
import { AuthenticationError } from "@/server/errors";
import { ApiTokenList } from "@/app/_components/api-token-list";
import { createApiTokenAction, revokeOwnApiTokenAction } from "./actions";
import { ApiTokenCreateForm } from "./api-token-create-form";

// "Acesso à API" (SPEC 2026-11-02-api-externa-webhooks, 5.1; decision A1): the requester, attendant
// or manager creates and revokes her own tokens. The administrator sees all tokens in her area.

const homeByRole = {
  REQUESTER: "/catalog",
  ATTENDANT: "/queue",
  MANAGER: "/approvals",
} as const;

const NOTICES: Record<string, { text: string; error: boolean }> = {
  revoked: { text: "Token revogado. Ele deixa de funcionar na próxima chamada.", error: false },
  "not-found": { text: "Token não encontrado.", error: true },
};

type ApiTokensPageProps = { searchParams: Promise<{ notice?: string }> };

export default async function ApiTokensPage({ searchParams }: ApiTokensPageProps) {
  let actor: AuthorizationActor;
  try {
    actor = await requireCurrentActor();
  } catch (error) {
    if (error instanceof AuthenticationError) redirect("/");
    throw error;
  }
  if (actor.role === "ADMIN") redirect("/admin?section=api-tokens");

  const home = homeByRole[actor.role];
  const [tokens, { notice }] = await Promise.all([listOwnApiTokens(), searchParams]);
  const message = notice ? NOTICES[notice] : undefined;

  return (
    <>
      <header className="app-topbar account-topbar">
        <Link className="brand-link" href={home}>
          <span aria-hidden="true" className="brand-mark">S</span>
          ServiceFlow
        </Link>
        <nav aria-label="Navegação principal">
          <Link href={home}>Voltar</Link>
        </nav>
        <SignOutButton />
      </header>
      <main className="page-shell">
        <section aria-labelledby="api-tokens-title" className="account-card">
          <p className="eyebrow">Integrações</p>
          <h1 id="api-tokens-title">Acesso à API</h1>
          <p>
            Crie um token para que outro sistema consulte ou abra solicitações em seu nome, com as mesmas permissões
            que você tem aqui. Use &quot;Somente leitura&quot; quando o sistema só precisar consultar.
          </p>
          <p className="metadata">
            Até {MAX_ACTIVE_API_TOKENS} tokens ativos e {API_CALLS_PER_MINUTE} chamadas por minuto por token. Guarde o
            token como uma senha; se ele vazar, revogue.
          </p>
          <ApiTokenCreateForm action={createApiTokenAction} />
        </section>
        <section aria-labelledby="api-tokens-list-title" className="surface-card">
          <h2 id="api-tokens-list-title">Seus tokens</h2>
          {message ? (
            <p className={`feedback${message.error ? " feedback-error" : ""}`} role={message.error ? "alert" : "status"}>
              {message.text}
            </p>
          ) : null}
          <ApiTokenList emptyText="Você ainda não criou nenhum token." revokeAction={revokeOwnApiTokenAction} tokens={tokens} />
        </section>
      </main>
    </>
  );
}
