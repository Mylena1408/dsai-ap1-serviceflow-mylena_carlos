import { z } from "zod";

// Distribution settings of a sector (SPEC 2026-11-07-operacao-e-automacao, 4.3 item 1): the mode
// (off by default), the limit of active requests per attendant and the handover when an attendant
// is absent. Only the administrator changes them, in "Setores", with the sector's audit trail.

export const SECTOR_DISTRIBUTION_MODES = ["NONE", "ROUND_ROBIN", "LEAST_LOAD"] as const;
export type SectorDistributionMode = (typeof SECTOR_DISTRIBUTION_MODES)[number];

export const MIN_ACTIVE_LIMIT = 1;
export const MAX_ACTIVE_LIMIT = 100;

export const DISTRIBUTION_MODE_LABELS: Record<SectorDistributionMode, string> = {
  NONE: "Desligada",
  ROUND_ROBIN: "Rodízio",
  LEAST_LOAD: "Menor carga",
};

const flag = z
  .union([z.boolean(), z.enum(["true", "false", "on"])])
  .optional()
  .transform((value) => value === true || value === "true" || value === "on");

export const distributionSettingsSchema = z
  .object({
    distributionMode: z.enum(SECTOR_DISTRIBUTION_MODES),
    // Blank means no limit; a form sends text.
    maxActivePerAttendant: z.preprocess(
      (value) => (value === undefined || value === null || (typeof value === "string" && value.trim() === "") ? null : value),
      z.coerce.number().int().min(MIN_ACTIVE_LIMIT).max(MAX_ACTIVE_LIMIT).nullable(),
    ),
    redistributeOnAbsence: flag,
  })
  .strict();

export type DistributionSettingsInput = z.output<typeof distributionSettingsSchema>;

/** "Rodízio · até 5 por atendente · passa as solicitações de quem se ausenta". */
export function distributionSummary(settings: DistributionSettingsInput): string {
  if (settings.distributionMode === "NONE") return DISTRIBUTION_MODE_LABELS.NONE;
  const parts = [
    DISTRIBUTION_MODE_LABELS[settings.distributionMode],
    settings.maxActivePerAttendant === null ? "sem limite" : `até ${settings.maxActivePerAttendant} por atendente`,
  ];
  if (settings.redistributeOnAbsence) parts.push("passa as solicitações de quem se ausenta");
  return parts.join(" · ");
}
