import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AnnouncementStrip } from "./_components/announcement-strip";
import "./globals.css";

export const metadata: Metadata = {
  title: "ServiceFlow",
  description:
    "Plataforma configurável para gerenciamento de solicitações de serviços internos.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>
        {/* SPEC 2026-11-09-comunicacao-e-calendarios, 3.1 item 2: above every area's header; nothing without a session. */}
        <AnnouncementStrip />
        {children}
      </body>
    </html>
  );
}
