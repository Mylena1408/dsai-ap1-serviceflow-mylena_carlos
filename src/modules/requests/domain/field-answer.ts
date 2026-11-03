import type { ServiceFieldType } from "@/modules/service-fields";

// Answer to a custom field as stored on opening (SPEC 2026-11-01-campos-personalizados, 5.4):
// label, type and position are the snapshot; the value is normalized text.
export interface RequestFieldAnswer {
  id: string;
  label: string;
  type: ServiceFieldType;
  position: number;
  value: string;
  /**
   * SPEC 2026-11-03-campos-condicionais-atendimento, 5.6: "ATTENDANT" for an answer saved by the
   * attendance (it has an author of the save), seen only by the team. Optional for older doubles.
   */
  audience?: "REQUESTER" | "ATTENDANT";
}
