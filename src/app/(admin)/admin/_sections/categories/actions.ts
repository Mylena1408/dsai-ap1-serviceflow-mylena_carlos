"use server";

import {
  createCategory,
  setCategoryActive,
  updateCategory,
} from "@/modules/categories";
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

export async function createCategoryAction(
  _previousState: AdminUpdateState,
  formData: FormData,
): Promise<AdminUpdateState> {
  try {
    await createCategory({ name: field(formData, "name") });
  } catch (error) {
    return createFailure(error);
  }
  return finishCreate();
}

export async function updateCategoryAction(
  _previousState: AdminUpdateState,
  formData: FormData,
): Promise<AdminUpdateState> {
  try {
    await updateCategory(field(formData, "id"), {
      name: field(formData, "name"),
    });
  } catch (error) {
    return updateFailure(error);
  }
  return finishUpdate();
}

export async function toggleCategoryAction(formData: FormData): Promise<never> {
  const section = selectedSection(formData);
  try {
    await setCategoryActive(
      field(formData, "id"),
      activeState(formData),
    );
  } catch (error) {
    reportFailure("categories", section, error);
  }
  return finish("categories", "status", section);
}
