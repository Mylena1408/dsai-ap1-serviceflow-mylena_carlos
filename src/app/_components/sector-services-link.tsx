import Link from "next/link";
import { actorHasPermission, requireCurrentActor } from "@/server/authorization";

async function canManageSectorServices(): Promise<boolean> {
  try {
    return await actorHasPermission(await requireCurrentActor(), "SECTOR_SERVICES");
  } catch {
    return false;
  }
}

// Shown only to holders of "Gerir serviços do setor" (SPEC 2026-11-01-permissoes-configuraveis,
// 5.3.1). Permissions are read on every render, so a revocation hides it at once.
export async function SectorServicesLink() {
  return (await canManageSectorServices()) ? <Link href="/sector-services">Serviços do setor</Link> : null;
}
