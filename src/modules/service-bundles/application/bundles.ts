import { activeStateAction, type AuditScope } from "@/modules/audit";
import { requireConfigurationAdministrator } from "@/server/authorization";
import { NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { activeStateSchema, entityIdSchema } from "@/shared/validation";
import {
  assertBundleServices,
  bundleAvailability,
  bundleInputSchema,
  type BundleAvailability,
  type BundleInput,
  type BundleRecord,
  type BundleServiceState,
} from "../domain/bundle";

// Configuration of the bundles (SPEC 2026-11-07-operacao-e-automacao, 3.3 item 2): only the
// administrator, because a bundle crosses sectors; every change goes to the audit trail. Changing or
// deactivating a service stays free: the bundle then leaves the catalog and says why.

export interface BundleView extends BundleRecord {
  availability: BundleAvailability;
}

export interface BundleOverview {
  bundles: BundleView[];
  /** Every service, with what decides whether it may be in a bundle. */
  services: BundleServiceState[];
}

export interface BundleReader {
  listBundles(): Promise<BundleRecord[]>;
  listServiceStates(): Promise<BundleServiceState[]>;
}

export interface BundleTransaction extends AuditScope {
  findBundle(bundleId: string): Promise<BundleRecord | null>;
  serviceStates(serviceIds: readonly string[]): Promise<BundleServiceState[]>;
  createBundle(input: BundleInput): Promise<BundleRecord>;
  updateBundle(bundleId: string, data: Partial<BundleInput> & { isActive?: boolean }): Promise<BundleRecord>;
}

export interface BundleStore {
  run<T>(work: (transaction: BundleTransaction) => Promise<T>): Promise<T>;
}

export async function listBundleOverview(reader: BundleReader): Promise<BundleOverview> {
  await requireConfigurationAdministrator();
  const [bundles, services] = await Promise.all([reader.listBundles(), reader.listServiceStates()]);
  return { bundles: bundles.map((bundle) => ({ ...bundle, availability: bundleAvailability(bundle, services) })), services };
}

export async function createBundle(input: unknown, store: BundleStore): Promise<BundleRecord> {
  const actor = await requireConfigurationAdministrator();
  const bundle = validateInput(bundleInputSchema, input);

  return store.run(async (transaction) => {
    assertBundleServices(bundle.serviceIds, await transaction.serviceStates(bundle.serviceIds));
    return transaction.audited({ actor, action: "CREATED", entityType: "SERVICE_BUNDLE" }, () => transaction.createBundle(bundle));
  });
}

/** Name, description and services; the services are checked again, as on creation. */
export async function updateBundle(id: unknown, input: unknown, store: BundleStore): Promise<BundleRecord> {
  const actor = await requireConfigurationAdministrator();
  const bundleId = validateInput(entityIdSchema, id);
  const bundle = validateInput(bundleInputSchema, input);

  return store.run(async (transaction) => {
    if (!(await transaction.findBundle(bundleId))) {
      throw new NotFoundError();
    }
    assertBundleServices(bundle.serviceIds, await transaction.serviceStates(bundle.serviceIds));
    return transaction.audited({ actor, action: "UPDATED", entityType: "SERVICE_BUNDLE", entityId: bundleId }, () =>
      transaction.updateBundle(bundleId, bundle),
    );
  });
}

/**
 * Deactivating takes the bundle out of the catalog; requests already opened keep their group.
 * Reactivating needs the name free among the active bundles (unique index); the services are not
 * checked, the catalog shows the bundle only while they can be opened.
 */
export async function setBundleActive(id: unknown, isActive: unknown, store: BundleStore): Promise<BundleRecord> {
  const actor = await requireConfigurationAdministrator();
  const bundleId = validateInput(entityIdSchema, id);
  const active = validateInput(activeStateSchema, isActive);

  return store.run(async (transaction) => {
    const bundle = await transaction.findBundle(bundleId);
    if (!bundle) {
      throw new NotFoundError();
    }
    if (bundle.isActive === active) {
      return bundle;
    }
    return transaction.audited({ actor, action: activeStateAction(active), entityType: "SERVICE_BUNDLE", entityId: bundleId }, () =>
      transaction.updateBundle(bundleId, { isActive: active }),
    );
  });
}
