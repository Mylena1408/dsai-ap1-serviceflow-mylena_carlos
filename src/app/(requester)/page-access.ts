import { redirect } from "next/navigation";
import { requirePublishedCatalogReader } from "@/server/authorization";
import { AuthenticationError, AuthorizationError } from "@/server/errors";

export async function requireRequesterPageAccess(): Promise<void> {
  try {
    await requirePublishedCatalogReader();
  } catch (error) {
    if (error instanceof AuthenticationError) redirect("/");
    if (error instanceof AuthorizationError) redirect("/");
    throw error;
  }
}
