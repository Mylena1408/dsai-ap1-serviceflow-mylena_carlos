import { requirePublishedCatalogReader } from "@/server/authorization";
import { NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";
import { bundleAvailability, type BundleRecord, type BundleServiceState } from "../domain/bundle";

// Bundles in the requester's catalog (SPEC 2026-11-07-operacao-e-automacao, 3.3 items 2 and 3,
// decision H20): only active bundles whose services can all be opened now; any other is "not found",
// as an unpublished service.

export interface CatalogBundle {
  id: string;
  name: string;
  description: string | null;
  /** In the bundle's order. */
  services: Array<{ id: string; name: string; sectorName: string }>;
}

export interface CatalogBundleReader {
  listActiveBundles(): Promise<BundleRecord[]>;
  findBundle(bundleId: string): Promise<BundleRecord | null>;
  serviceStates(serviceIds: readonly string[]): Promise<BundleServiceState[]>;
}

function asCatalogBundle(bundle: BundleRecord, states: readonly BundleServiceState[]): CatalogBundle | null {
  if (!bundleAvailability(bundle, states).openable) return null;
  const byId = new Map(states.map((state) => [state.id, state]));
  return {
    id: bundle.id,
    name: bundle.name,
    description: bundle.description,
    services: bundle.serviceIds.map((id) => {
      const state = byId.get(id)!;
      return { id, name: state.name, sectorName: state.sectorName };
    }),
  };
}

export async function listCatalogBundles(reader: CatalogBundleReader): Promise<CatalogBundle[]> {
  await requirePublishedCatalogReader();
  const bundles = await reader.listActiveBundles();
  const states = await reader.serviceStates([...new Set(bundles.flatMap(({ serviceIds }) => serviceIds))]);
  return bundles.flatMap((bundle) => asCatalogBundle(bundle, states) ?? []);
}

export async function getCatalogBundle(bundleId: unknown, reader: CatalogBundleReader): Promise<CatalogBundle> {
  await requirePublishedCatalogReader();
  const id = validateInput(entityIdSchema, bundleId);
  const bundle = await reader.findBundle(id);
  const found = bundle ? asCatalogBundle(bundle, await reader.serviceStates(bundle.serviceIds)) : null;
  if (!found) {
    throw new NotFoundError();
  }
  return found;
}
