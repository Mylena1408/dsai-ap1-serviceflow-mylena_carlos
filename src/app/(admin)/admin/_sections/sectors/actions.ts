"use server";

import {
  createSector,
  setSectorActive,
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
