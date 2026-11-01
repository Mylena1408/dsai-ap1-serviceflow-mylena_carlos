import Link from "next/link";
import { SignOutButton } from "@/modules/auth";
import { NotificationsLink } from "@/app/_components/notifications";
import type { ReactNode } from "react";

export default function RequesterLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <>
      <header className="app-topbar">
        <Link className="brand-link" href="/catalog">
          <span className="brand-mark" aria-hidden="true">S</span>
          ServiceFlow
        </Link>
        <nav aria-label="Navegação principal">
          <Link href="/catalog">Catálogo</Link>
          <Link href="/requests">Minhas solicitações</Link>
          <NotificationsLink href="/notifications" />
          <Link href="/account/password">Alterar senha</Link>
        </nav>
        <SignOutButton />
      </header>
      {children}
    </>
  );
}
