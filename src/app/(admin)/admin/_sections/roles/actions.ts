"use server";

import { createAccessRole, setAccessRoleActive, updateAccessRole } from "@/modules/permissions";
import { activeState, field, finish, reportFailure } from "../../_shared/action-helpers";

// "Papéis" of the administration (SPEC 2026-11-06-aprofundamento-configurabilidade, 6.3.1): only the
// administrator creates, edits, deactivates and reactivates; the use cases record the audit trail.

function roleInput(formData: FormData) {
  return {
    name: field(formData, "name"),
    description: field(formData, "description"),
    permissions: formData.getAll("permissions").filter((value): value is string => typeof value === "string"),
  };
}

export async function createRoleAction(formData: FormData): Promise<never> {
  try {
    await createAccessRole(roleInput(formData));
  } catch (error) {
    reportFailure("roles", "roles", error);
  }
  return finish("roles", "created", "roles");
}

export async function updateRoleAction(formData: FormData): Promise<never> {
  try {
    await updateAccessRole(field(formData, "id"), roleInput(formData));
  } catch (error) {
    reportFailure("roles", "roles", error);
  }
  return finish("roles", "updated", "roles");
}

export async function toggleRoleAction(formData: FormData): Promise<never> {
  try {
    await setAccessRoleActive(field(formData, "id"), activeState(formData));
  } catch (error) {
    reportFailure("roles", "roles", error);
  }
  return finish("roles", "status", "roles");
}
