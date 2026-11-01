import Link from "next/link";
import { SignOutButton } from "@/modules/auth";
import { NotificationsLink } from "@/app/_components/notifications";
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
          <NotificationsLink href="/queue/notifications" />
          <Link href="/account/password">Alterar senha</Link>
        </nav>
        <SignOutButton />
      </header>
      {children}
    </>
  );
}
