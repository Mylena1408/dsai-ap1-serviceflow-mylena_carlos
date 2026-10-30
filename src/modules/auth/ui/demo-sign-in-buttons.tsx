"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

const DEMO_OPTIONS = [
  { role: "ADMIN", label: "Entrar como Administrador" },
  { role: "REQUESTER", label: "Entrar como Solicitante" },
  { role: "ATTENDANT", label: "Entrar como Atendente" },
] as const;

export function DemoSignInButtons() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<string | null>(null);

  async function enterAs(role: (typeof DEMO_OPTIONS)[number]["role"]) {
    setError(null);
    setPendingRole(role);

    try {
      const result = await signIn("demo", { role, redirect: false });

      if (!result || result.error) {
        setError("Não foi possível entrar agora. Tente novamente.");
        return;
      }

      router.push("/");
    } catch {
      setError("Não foi possível entrar agora. Tente novamente.");
    } finally {
      setPendingRole(null);
    }
  }

  return (
    <div className="login-form" role="group" aria-label="Acesso de demonstração">
      {DEMO_OPTIONS.map(({ role, label }) => (
        <button disabled={pendingRole !== null} key={role} onClick={() => enterAs(role)} type="button">
          {pendingRole === role ? "Entrando..." : label}
        </button>
      ))}
      {error ? <p className="login-error" role="alert">{error}</p> : null}
    </div>
  );
}
