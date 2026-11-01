"use server";

import {
  createUser,
  setUserActive,
  updateUser,
} from "@/modules/users";
import { grantPermission, revokePermission } from "@/modules/permissions";
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

export async function createUserAction(
  _previousState: AdminUpdateState,
  formData: FormData,
): Promise<AdminUpdateState> {
  try {
    await createUser({
      name: field(formData, "name"),
      email: field(formData, "email"),
      password: field(formData, "password"),
      role: field(formData, "role"),
      sectorId: field(formData, "sectorId") || null,
    });
  } catch (error) {
    return createFailure(error);
  }
  return finishCreate();
}

export async function updateUserAction(
  _previousState: AdminUpdateState,
  formData: FormData,
): Promise<AdminUpdateState> {
  try {
    await updateUser(field(formData, "id"), {
      name: field(formData, "name"),
      email: field(formData, "email"),
      password: field(formData, "password") || undefined,
      role: field(formData, "role"),
      sectorId: field(formData, "sectorId") || null,
    });
  } catch (error) {
    return updateFailure(error);
  }
  return finishUpdate();
}

export async function toggleUserAction(formData: FormData): Promise<never> {
  const section = selectedSection(formData);
  try {
    await setUserActive(
      field(formData, "id"),
      activeState(formData),
    );
  } catch (error) {
    reportFailure("users", section, error);
  }
  return finish("users", "status", section);
}

// SPEC 2026-11-01-permissoes-configuraveis, 5.2: the administrator grants and revokes.
async function changePermission(formData: FormData, grant: boolean): Promise<never> {
  const section = selectedSection(formData);
  const input = { userId: field(formData, "userId"), permission: field(formData, "permission") };
  try {
    await (grant ? grantPermission(input) : revokePermission(input));
  } catch (error) {
    reportFailure("permissions", section, error);
  }
  return finish("permissions", "updated", section);
}

export async function grantPermissionAction(formData: FormData): Promise<never> {
  return changePermission(formData, true);
}

export async function revokePermissionAction(formData: FormData): Promise<never> {
  return changePermission(formData, false);
}
