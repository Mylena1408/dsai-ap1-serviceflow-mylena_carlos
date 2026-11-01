import Link from "next/link";
import { SignOutButton } from "@/modules/auth";
import { NotificationsLink } from "@/app/_components/notifications";
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
          <NotificationsLink href="/approvals/notifications" />
          <Link href="/account/password">Alterar senha</Link>
        </nav>
        <SignOutButton />
      </header>
      {children}
    </>
  );
}
