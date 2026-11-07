"use server";

import {
  anonymizeUser,
  createUser,
  setUserActive,
  updateUser,
} from "@/modules/users";
import { assignAccessRole, grantPermission, removeAccessRole, revokePermission } from "@/modules/permissions";
import {
  activeState,
  createFailure,
  field,
  finish,
  finishCreate,
  finishUpdate,
  isValidityFailure,
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

// SPEC 2026-11-01-permissoes-configuraveis, 5.2: the administrator grants and revokes; a grant may
// have an end (SPEC 2026-11-06-aprofundamento-configurabilidade, 6.3.2).
async function changePermission(formData: FormData, grant: boolean): Promise<never> {
  const section = selectedSection(formData);
  const input = { userId: field(formData, "userId"), permission: field(formData, "permission") };
  try {
    // The end only when the form has the field (blank = no end).
    const end = formData.has("expiresOn") ? { expiresOn: field(formData, "expiresOn") } : {};
    await (grant ? grantPermission({ ...input, ...end }) : revokePermission(input));
  } catch (error) {
    reportFailure(isValidityFailure(error) ? "permissionValidity" : "permissions", section, error);
  }
  return finish("permissions", "updated", section);
}

// SPEC 2026-11-06-aprofundamento-configurabilidade, 6.3.1: roles given to a user, optionally up to a day.
export async function assignRoleAction(formData: FormData): Promise<never> {
  const section = selectedSection(formData);
  try {
    await assignAccessRole({
      userId: field(formData, "userId"),
      roleId: field(formData, "roleId"),
      expiresOn: field(formData, "expiresOn"),
    });
  } catch (error) {
    reportFailure(isValidityFailure(error) ? "roleValidity" : "roleAssignments", section, error);
  }
  return finish("roleAssignments", "updated", section);
}

export async function removeRoleAction(formData: FormData): Promise<never> {
  const section = selectedSection(formData);
  try {
    await removeAccessRole({ userId: field(formData, "userId"), roleId: field(formData, "roleId") });
  } catch (error) {
    reportFailure("roleAssignments", section, error);
  }
  return finish("roleAssignments", "updated", section);
}

export async function grantPermissionAction(formData: FormData): Promise<never> {
  return changePermission(formData, true);
}

export async function revokePermissionAction(formData: FormData): Promise<never> {
  return changePermission(formData, false);
}

// SPEC 2026-11-02-auditoria-lgpd, 5.5: irreversible, only with the explicit confirmation.
export async function anonymizeUserAction(formData: FormData): Promise<never> {
  const section = selectedSection(formData);
  try {
    await anonymizeUser({
      userId: field(formData, "userId"),
      confirmed: field(formData, "confirmed") === "true",
    });
  } catch (error) {
    reportFailure("anonymization", section, error);
  }
  return finish("anonymization", "anonymized", section);
}
