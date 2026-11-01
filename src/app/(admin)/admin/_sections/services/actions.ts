"use server";

import {
  createService,
  setServiceActive,
  updateService,
} from "@/modules/services";
import {
  createDocumentRequirement,
  deactivateDocumentRequirement,
  moveDocumentRequirement,
  updateDocumentRequirement,
} from "@/modules/document-requirements";
import {
  activeState,
  createFailure,
  documentRequirementFields,
  field,
  finish,
  finishCreate,
  finishUpdate,
  reportFailure,
  selectedSection,
  updateFailure,
  type AdminUpdateState,
} from "../../_shared/action-helpers";

// Only sent when the form has the fields, so a form without them keeps the current values
// (SPEC 2026-11-01-sla-prioridades, section 5.6).
function slaFields(formData: FormData) {
  return {
    ...(formData.has("defaultPriority") ? { defaultPriority: field(formData, "defaultPriority") } : {}),
    ...(formData.has("slaHours") ? { slaHours: field(formData, "slaHours") } : {}),
  };
}

export async function createServiceAction(
  _previousState: AdminUpdateState,
  formData: FormData,
): Promise<AdminUpdateState> {
  try {
    await createService({
      name: field(formData, "name"),
      description: field(formData, "description"),
      categoryId: field(formData, "categoryId"),
      sectorId: field(formData, "sectorId"),
      ...slaFields(formData),
    });
  } catch (error) {
    return createFailure(error);
  }
  return finishCreate();
}

export async function updateServiceAction(
  _previousState: AdminUpdateState,
  formData: FormData,
): Promise<AdminUpdateState> {
  try {
    await updateService(field(formData, "id"), {
      name: field(formData, "name"),
      description: field(formData, "description"),
      categoryId: field(formData, "categoryId"),
      sectorId: field(formData, "sectorId"),
      ...slaFields(formData),
    });
  } catch (error) {
    return updateFailure(error);
  }
  return finishUpdate();
}

export async function toggleServiceAction(formData: FormData): Promise<never> {
  const section = selectedSection(formData);
  try {
    await setServiceActive(
      field(formData, "id"),
      activeState(formData),
    );
  } catch (error) {
    reportFailure("services", section, error);
  }
  return finish("services", "status", section);
}

export async function createDocumentRequirementAction(
  _previousState: AdminUpdateState,
  formData: FormData,
): Promise<AdminUpdateState> {
  try {
    await createDocumentRequirement(
      field(formData, "serviceId"),
      documentRequirementFields(formData),
    );
  } catch (error) {
    return createFailure(error);
  }
  return finishCreate();
}

export async function updateDocumentRequirementAction(
  _previousState: AdminUpdateState,
  formData: FormData,
): Promise<AdminUpdateState> {
  try {
    await updateDocumentRequirement(
      field(formData, "id"),
      documentRequirementFields(formData),
    );
  } catch (error) {
    return updateFailure(error);
  }
  return finishUpdate();
}

export async function moveDocumentRequirementAction(formData: FormData): Promise<never> {
  const section = selectedSection(formData);
  try {
    await moveDocumentRequirement(
      field(formData, "id"),
      field(formData, "direction"),
    );
  } catch (error) {
    reportFailure("documentRequirements", section, error);
  }
  return finish("documentRequirements", "updated", section);
}

export async function deactivateDocumentRequirementAction(formData: FormData): Promise<never> {
  const section = selectedSection(formData);
  try {
    await deactivateDocumentRequirement(field(formData, "id"));
  } catch (error) {
    reportFailure("documentRequirements", section, error);
  }
  return finish("documentRequirements", "status", section);
}
