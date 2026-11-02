import { redirect } from "next/navigation";
import { DemoSignInButtons } from "@/modules/auth";
import { getCurrentUser } from "@/server/auth";

// The root is the entrance (SPEC 2026-09-30, section 24): without a session it shows the
// profile choice, never an e-mail and password form; with one, it goes to the profile area.
export default async function HomePage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <main className="login-screen">
        <section className="login-card" aria-labelledby="entry-title">
          <p className="brand-link">
            <span className="brand-mark" aria-hidden="true">S</span>
            ServiceFlow
          </p>
          <p className="eyebrow">Modo demonstração</p>
          <h1 id="entry-title">Escolha um perfil</h1>
          <p>Escolha um perfil para explorar o ServiceFlow.</p>
          <DemoSignInButtons />
        </section>
      </main>
    );
  }

  switch (user.role) {
    case "ADMIN":
      redirect("/admin");
    case "REQUESTER":
      redirect("/catalog");
    case "ATTENDANT":
      redirect("/queue");
    case "MANAGER":
      // SPEC 2026-11-01-aprovacoes, 5.1: the manager area (SF-082).
      redirect("/approvals");
  }
}
