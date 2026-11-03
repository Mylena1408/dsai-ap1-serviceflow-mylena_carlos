import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/modules/auth";
import { requireCurrentActor, type AuthorizationActor } from "@/server/authorization";
import { AuthenticationError } from "@/server/errors";

// "Meus dados" (SPEC 2026-11-02-auditoria-lgpd, 5.4): every profile, only the own data.

const homeByRole = {
  ADMIN: "/admin",
  REQUESTER: "/catalog",
  ATTENDANT: "/queue",
  MANAGER: "/approvals",
} as const;

export default async function PersonalDataPage() {
  let actor: AuthorizationActor;
  try {
    actor = await requireCurrentActor();
  } catch (error) {
    if (error instanceof AuthenticationError) redirect("/");
    throw error;
  }

  return (
    <>
      <header className="app-topbar account-topbar">
        <Link className="brand-link" href={homeByRole[actor.role]}>
          <span aria-hidden="true" className="brand-mark">S</span>
          ServiceFlow
        </Link>
        <nav aria-label="Navegação principal">
          <Link href={homeByRole[actor.role]}>Voltar</Link>
        </nav>
        <SignOutButton />
      </header>
      <main className="page-shell">
        <section aria-labelledby="personal-data-title" className="account-card">
          <p className="eyebrow">Privacidade</p>
          <h1 id="personal-data-title">Meus dados</h1>
          <p>
            Baixe um arquivo com os dados pessoais que o ServiceFlow guarda sobre você: seu perfil, os e-mails que
            você escolheu receber, as solicitações que abriu (com descrição, respostas, histórico e comentários
            públicos), os comentários que escreveu, os nomes dos anexos enviados, as notificações recentes, as
            permissões recebidas e os tokens de acesso à API (sem o valor do token).
          </p>
          <p className="metadata">
            O arquivo não traz sua senha nem notas internas escritas por outras pessoas. Cada download fica registrado.
          </p>
          <form method="get" action="/api/account/data">
            <button type="submit">Baixar meus dados</button>
          </form>
        </section>
      </main>
    </>
  );
}
