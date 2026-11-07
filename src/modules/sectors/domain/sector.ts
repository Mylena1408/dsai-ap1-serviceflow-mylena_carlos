export interface SectorRecord {
  id: string;
  name: string;
  isActive: boolean;
  /** SPEC 2026-11-06-escalonamento, 2.1. Optional only for records built before the setting. */
  escalateOverdue?: boolean;
  /** SPEC 2026-11-07-operacao-e-automacao, 4.3. Optional only for records built before the setting. */
  distributionMode?: "NONE" | "ROUND_ROBIN" | "LEAST_LOAD";
  maxActivePerAttendant?: number | null;
  redistributeOnAbsence?: boolean;
  createdAt: Date;
  updatedAt: Date;
}
