import { ValidationError } from "@/server/errors";

// SLA configuration of a service (SPEC 2026-11-01-sla-prioridades, sections 5.1 and 5.2).

export type ServicePriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export const SERVICE_PRIORITIES: readonly ServicePriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];
export const MIN_SLA_HOURS = 1;
export const MAX_SLA_HOURS = 2_000;

/** Base SLA: empty means no SLA; otherwise a whole number of hours from 1 to 2,000. */
export function parseSlaHours(raw: unknown): number | null {
  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) {
    return null;
  }

  const value = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;

  if (!Number.isInteger(value) || value < MIN_SLA_HOURS || value > MAX_SLA_HOURS) {
    throw new ValidationError([{ path: ["slaHours"], code: "invalid_value" }]);
  }

  return value;
}
