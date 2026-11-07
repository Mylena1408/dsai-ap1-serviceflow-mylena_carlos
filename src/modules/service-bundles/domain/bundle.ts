import { z } from "zod";
import { ValidationError } from "@/server/errors";
import { entityIdSchema } from "@/shared/validation";

// Bundles of services (SPEC 2026-11-07-operacao-e-automacao, 3.3 item 2, decisions H3, H5 and H20): a
// name and 2 to 5 services, in order, opened together by the requester. Only services that can
// receive requests without documents enter a bundle, and the bundle leaves the catalog while one of
// its services stops being so.

export const MAX_BUNDLE_NAME_LENGTH = 80;
export const MAX_BUNDLE_DESCRIPTION_LENGTH = 500;
export const MIN_BUNDLE_SERVICES = 2;
export const MAX_BUNDLE_SERVICES = 5;

const optionalText = (max: number) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((value) => (value === undefined || value === null || value.trim() === "" ? null : value.trim()))
    .refine((value) => value === null || value.length <= max);

export const bundleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_BUNDLE_NAME_LENGTH),
    description: optionalText(MAX_BUNDLE_DESCRIPTION_LENGTH),
    /** In order; blanks (empty selects) are dropped first. */
    serviceIds: z
      .array(z.string())
      .transform((ids) => ids.map((id) => id.trim()).filter((id) => id !== ""))
      .pipe(z.array(entityIdSchema).min(MIN_BUNDLE_SERVICES).max(MAX_BUNDLE_SERVICES))
      .refine((ids) => new Set(ids).size === ids.length),
  })
  .strict();

export type BundleInput = z.output<typeof bundleInputSchema>;

export interface BundleRecord {
  id: string;
  name: string;
  description: string | null;
  serviceIds: string[];
  isActive: boolean;
}

/** What decides whether a service may be in a bundle and the bundle in the catalog. */
export interface BundleServiceState {
  id: string;
  name: string;
  sectorName: string;
  isActive: boolean;
  categoryActive: boolean;
  sectorActive: boolean;
  /** Active document requirements, required or optional (decision H5). */
  activeRequirements: number;
}

export type BundleServiceProblem = "inactive" | "category_inactive" | "sector_inactive" | "documents";

export const BUNDLE_PROBLEM_LABELS: Record<BundleServiceProblem, string> = {
  inactive: "serviço inativo",
  category_inactive: "categoria inativa",
  sector_inactive: "setor inativo",
  documents: "pede documentos",
};

/** Why a service cannot be opened in a bundle now; empty when it can. */
export function serviceProblems(service: BundleServiceState): BundleServiceProblem[] {
  return [
    ...(service.isActive ? [] : (["inactive"] as const)),
    ...(service.categoryActive ? [] : (["category_inactive"] as const)),
    ...(service.sectorActive ? [] : (["sector_inactive"] as const)),
    ...(service.activeRequirements > 0 ? (["documents"] as const) : []),
  ];
}

/** 3.3 item 2: every service exists and may be in a bundle now. */
export function assertBundleServices(serviceIds: readonly string[], services: readonly BundleServiceState[]): void {
  const byId = new Map(services.map((service) => [service.id, service]));
  if (serviceIds.some((id) => !byId.has(id) || serviceProblems(byId.get(id)!).length > 0)) {
    throw new ValidationError([{ path: ["serviceIds"], code: "invalid_value" }]);
  }
}

export interface BundleAvailability {
  /** Shown in the catalog: active, and every service can be opened (3.3 item 2). */
  openable: boolean;
  /** One line per service that keeps the bundle out of the catalog. */
  problems: Array<{ serviceId: string; serviceName: string; problems: BundleServiceProblem[] }>;
}

export function bundleAvailability(bundle: Pick<BundleRecord, "serviceIds" | "isActive">, services: readonly BundleServiceState[]): BundleAvailability {
  const byId = new Map(services.map((service) => [service.id, service]));
  const problems = bundle.serviceIds.flatMap((id) => {
    const service = byId.get(id);
    const found = service ? serviceProblems(service) : (["inactive"] as BundleServiceProblem[]);
    return found.length > 0 ? [{ serviceId: id, serviceName: service?.name ?? "(serviço removido)", problems: found }] : [];
  });
  return { openable: bundle.isActive && problems.length === 0, problems };
}

/** "Fora do catálogo: Troca de crachá (pede documentos); Acesso ao sistema (serviço inativo)". */
export function availabilityText(availability: BundleAvailability): string | null {
  if (availability.problems.length === 0) return null;
  return availability.problems
    .map(({ serviceName, problems }) => `${serviceName} (${problems.map((problem) => BUNDLE_PROBLEM_LABELS[problem]).join(", ")})`)
    .join("; ");
}
