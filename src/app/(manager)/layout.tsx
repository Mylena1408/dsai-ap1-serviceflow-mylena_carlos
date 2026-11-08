import Link from "next/link";
import { SignOutButton } from "@/modules/auth";
import { NotificationsLink } from "@/app/_components/notifications";
import { SectorServicesLink } from "@/app/_components/sector-services-link";
import type { ReactNode } from "react";

// Manager area (SPEC 2026-11-01-aprovacoes, 5.1 and 5.7).
export default function ManagerLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <>
      <header className="app-topbar">
        <Link className="brand-link" href="/approvals">
          <span className="brand-mark" aria-hidden="true">S</span>
          ServiceFlow
        </Link>
        <nav aria-label="Navegação principal">
          <Link href="/approvals">Aprovações</Link>
          <Link href="/approvals/dashboard">Painel do setor</Link>
          <Link href="/approvals/analytics">Análises</Link>
          {/* SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.5. */}
          <Link href="/approvals/absences">Ausências</Link>
          {/* SPEC 2026-11-07-operacao-e-automacao, 4.3 item 7. */}
          <Link href="/approvals/team-absences">Afastamentos da equipe</Link>
          {/* SPEC 2026-11-07-operacao-e-automacao, 5.3 item 4. */}
          <Link href="/approvals/recurring">Agendas</Link>
          {/* SPEC 2026-11-08-atendimento-dia-a-dia, 3.3 item 1. */}
          <Link href="/approvals/tags">Etiquetas</Link>
          {/* SPEC 2026-11-08-atendimento-dia-a-dia, 4.1 item 1. */}
          <Link href="/approvals/checklists">Checklists</Link>
          <NotificationsLink href="/approvals/notifications" />
          <SectorServicesLink />
          <Link href="/account/data">Meus dados</Link>
          <Link href="/account/api-tokens">Acesso à API</Link>
          <Link href="/account/password">Alterar senha</Link>
        </nav>
        <SignOutButton />
      </header>
      {children}
    </>
  );
}
