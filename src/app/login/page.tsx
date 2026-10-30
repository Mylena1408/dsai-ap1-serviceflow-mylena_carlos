import Link from "next/link";
import { LoginForm } from "@/modules/auth";

export default function LoginPage() {
  return (
    <main className="login-screen">
      <section className="login-card" aria-labelledby="login-title">
        <Link className="brand-link" href="/">
          <span className="brand-mark" aria-hidden="true">S</span>
          ServiceFlow
        </Link>
        <p className="eyebrow">Acesso seguro</p>
        <h1 id="login-title">Entre na sua conta</h1>
        <p>Use suas credenciais para acessar o catálogo e acompanhar os serviços.</p>
        <LoginForm />
      </section>
    </main>
  );
}
