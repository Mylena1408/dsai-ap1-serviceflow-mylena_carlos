import type { ServiceFieldType } from "@/modules/service-fields";

// Answer to a custom field as stored on opening (SPEC 2026-11-01-campos-personalizados, 5.4):
// label, type and position are the snapshot; the value is normalized text.
export interface RequestFieldAnswer {
  id: string;
  label: string;
  type: ServiceFieldType;
  position: number;
  value: string;
}
