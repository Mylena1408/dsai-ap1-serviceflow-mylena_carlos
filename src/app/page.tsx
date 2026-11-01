import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";

export default async function HomePage(): Promise<never> {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
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
