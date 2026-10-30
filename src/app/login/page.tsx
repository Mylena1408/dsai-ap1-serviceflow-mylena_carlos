import Link from "next/link";
import { DemoSignInButtons, LoginForm } from "@/modules/auth";

export default function LoginPage() {
  return (
    <main className="login-screen">
      <section className="login-card" aria-labelledby="login-title">
        <Link className="brand-link" href="/">
          <span className="brand-mark" aria-hidden="true">S</span>
          ServiceFlow
        </Link>
        <p className="eyebrow">Modo demonstração</p>
        <h1 id="login-title">Entre na sua conta</h1>
        <p>Escolha um perfil para explorar o ServiceFlow. Não é preciso e-mail nem senha.</p>
        <DemoSignInButtons />
        <details className="login-credentials">
          <summary>Entrar com e-mail e senha</summary>
          <LoginForm />
        </details>
      </section>
    </main>
  );
}
