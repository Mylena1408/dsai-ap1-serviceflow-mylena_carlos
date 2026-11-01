import { ConflictError } from "@/server/errors";

// SPEC 2026-11-01-campos-personalizados, sections 5.1, 5.2 and 6.

export const SERVICE_FIELD_TYPES = ["SHORT_TEXT", "LONG_TEXT", "INTEGER", "DATE", "SELECT", "YES_NO"] as const;

export type ServiceFieldType = (typeof SERVICE_FIELD_TYPES)[number];

// Decision F4: at most ten active fields per service.
export const MAX_ACTIVE_SERVICE_FIELDS = 10;

export const SERVICE_FIELD_LIMITS = {
  label: 80,
  helpText: 200,
  minOptions: 2,
  maxOptions: 20,
  option: 80,
  integerBound: 1_000_000_000,
  shortText: 200,
  longText: 2_000,
  firstDate: "1900-01-01",
  lastDate: "2100-12-31",
} as const;

export interface ServiceFieldDefinition {
  label: string;
  helpText: string | null;
  type: ServiceFieldType;
  isRequired: boolean;
  // Only list fields have options; only integer fields have limits.
  options: string[];
  minValue: number | null;
  maxValue: number | null;
}

export interface ServiceFieldRecord extends ServiceFieldDefinition {
  id: string;
  serviceId: string;
  position: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function assertCanAddActiveField(activeFieldCount: number): void {
  if (activeFieldCount >= MAX_ACTIVE_SERVICE_FIELDS) {
    throw new ConflictError();
  }
}

// Section 5.1: the type never changes; the administrator deactivates the field and creates another.
export function assertFieldTypeUnchanged(current: ServiceFieldType, requested: ServiceFieldType): void {
  if (current !== requested) {
    throw new ConflictError();
  }
}
