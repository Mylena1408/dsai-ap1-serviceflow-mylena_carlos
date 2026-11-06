"use server";

import {
  createSector,
  setSectorActive,
  setSectorEscalation,
  updateSector,
} from "@/modules/sectors";
import {
  activeState,
  createFailure,
  field,
  finish,
  finishCreate,
  finishUpdate,
  reportFailure,
  selectedSection,
  updateFailure,
  type AdminUpdateState,
} from "../../_shared/action-helpers";

export async function createSectorAction(
  _previousState: AdminUpdateState,
  formData: FormData,
): Promise<AdminUpdateState> {
  try {
    await createSector({ name: field(formData, "name") });
  } catch (error) {
    return createFailure(error);
  }
  return finishCreate();
}

export async function updateSectorAction(
  _previousState: AdminUpdateState,
  formData: FormData,
): Promise<AdminUpdateState> {
  try {
    await updateSector(field(formData, "id"), {
      name: field(formData, "name"),
    });
  } catch (error) {
    return updateFailure(error);
  }
  return finishUpdate();
}

export async function toggleSectorAction(formData: FormData): Promise<never> {
  const section = selectedSection(formData);
  try {
    await setSectorActive(
      field(formData, "id"),
      activeState(formData),
    );
  } catch (error) {
    reportFailure("sectors", section, error);
  }
  return finish("sectors", "status", section);
}

// SPEC 2026-11-06-escalonamento, 2.1: the "Escalar solicitações vencidas" setting of a sector.
export async function setSectorEscalationAction(formData: FormData): Promise<never> {
  const section = selectedSection(formData);
  try {
    await setSectorEscalation(field(formData, "id"), field(formData, "escalateOverdue") === "true");
  } catch (error) {
    reportFailure("sectors", section, error);
  }
  return finish("sectors", "status", section);
}
