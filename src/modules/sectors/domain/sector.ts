export interface SectorRecord {
  id: string;
  name: string;
  isActive: boolean;
  /** SPEC 2026-11-06-escalonamento, 2.1. Optional only for records built before the setting. */
  escalateOverdue?: boolean;
  createdAt: Date;
  updatedAt: Date;
}
