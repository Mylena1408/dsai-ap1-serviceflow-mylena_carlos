import Link from "next/link";
import { SignOutButton } from "@/modules/auth";
import { NotificationsLink } from "@/app/_components/notifications";
import { SectorServicesLink } from "@/app/_components/sector-services-link";
import { MyMentionsLink } from "@/app/_components/my-mentions";
import type { ReactNode } from "react";

export default function AttendantLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <>
      <header className="app-topbar">
        <Link className="brand-link" href="/queue">
          <span className="brand-mark" aria-hidden="true">S</span>
          ServiceFlow
        </Link>
        <nav aria-label="Navegação principal">
          <Link href="/queue">Fila do meu setor</Link>
          <Link href="/queue/dashboard">Meu painel</Link>
          <Link href="/queue/responses">Respostas prontas</Link>
          {/* SPEC 2026-11-07-operacao-e-automacao, 4.3 item 7. */}
          <Link href="/queue/absences">Minhas ausências</Link>
          <NotificationsLink href="/queue/notifications" />
          {/* SPEC 2026-11-08-atendimento-dia-a-dia, 13.4 item 1. */}
          <MyMentionsLink />
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
