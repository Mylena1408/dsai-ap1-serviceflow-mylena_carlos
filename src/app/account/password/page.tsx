import Link from "next/link";
import { redirect } from "next/navigation";
import { ChangePasswordForm, SignOutButton } from "@/modules/auth";
import { requireCurrentActor } from "@/server/authorization";
import { AuthenticationError } from "@/server/errors";
import type { AuthorizationActor } from "@/server/authorization";
import { changeOwnPasswordAction } from "./actions";

const homeByRole = {
  ADMIN: "/admin",
  REQUESTER: "/catalog",
  ATTENDANT: "/queue",
} as const;

export default async function ChangePasswordPage() {
  let actor: AuthorizationActor;
  try {
    actor = await requireCurrentActor();
  } catch (error) {
    if (error instanceof AuthenticationError) redirect("/login");
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
        <section aria-labelledby="password-title" className="account-card">
          <p className="eyebrow">Segurança da conta</p>
          <h1 id="password-title">Alterar senha</h1>
          <p>Confirme sua senha atual para definir uma nova senha com pelo menos 12 caracteres.</p>
          <ChangePasswordForm action={changeOwnPasswordAction} cancelHref={homeByRole[actor.role]} />
        </section>
      </main>
    </>
  );
}
