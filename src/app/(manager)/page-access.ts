import { redirect } from "next/navigation";
import { requireCurrentActor, assertRole, type AuthorizationActor } from "@/server/authorization";
import { AuthenticationError, AuthorizationError } from "@/server/errors";

// SPEC 2026-11-01-aprovacoes, 5.1: only managers enter this area; anyone else goes home.
export async function requireManagerPageAccess(): Promise<AuthorizationActor> {
  try {
    return assertRole(await requireCurrentActor(), "MANAGER");
  } catch (error) {
    if (error instanceof AuthenticationError) redirect("/login");
    if (error instanceof AuthorizationError) redirect("/");
    throw error;
  }
}
