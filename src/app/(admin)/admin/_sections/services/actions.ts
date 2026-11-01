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
  createServiceField,
  deactivateServiceField,
  moveServiceField,
  reactivateServiceField,
  updateServiceField,
} from "@/modules/service-fields";
import {
  createServiceStage,
  deactivateServiceStage,
  moveServiceStage,
  reactivateServiceStage,
  renameServiceStage,
} from "@/modules/service-stages";
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
  serviceFieldFields,
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

export async function createServiceFieldAction(
  _previousState: AdminUpdateState,
  formData: FormData,
): Promise<AdminUpdateState> {
  try {
    await createServiceField(field(formData, "serviceId"), serviceFieldFields(formData));
  } catch (error) {
    return createFailure(error);
  }
  return finishCreate();
}

export async function updateServiceFieldAction(
  _previousState: AdminUpdateState,
  formData: FormData,
): Promise<AdminUpdateState> {
  try {
    await updateServiceField(field(formData, "id"), serviceFieldFields(formData));
  } catch (error) {
    return updateFailure(error);
  }
  return finishUpdate();
}

export async function moveServiceFieldAction(formData: FormData): Promise<never> {
  const section = selectedSection(formData);
  try {
    await moveServiceField(field(formData, "id"), field(formData, "direction"));
  } catch (error) {
    reportFailure("serviceFields", section, error);
  }
  return finish("serviceFields", "updated", section);
}

export async function deactivateServiceFieldAction(formData: FormData): Promise<never> {
  const section = selectedSection(formData);
  try {
    await deactivateServiceField(field(formData, "id"));
  } catch (error) {
    reportFailure("serviceFields", section, error);
  }
  return finish("serviceFields", "status", section);
}

export async function reactivateServiceFieldAction(formData: FormData): Promise<never> {
  const section = selectedSection(formData);
  try {
    await reactivateServiceField(field(formData, "id"));
  } catch (error) {
    reportFailure("serviceFields", section, error);
  }
  return finish("serviceFields", "status", section);
}

export async function createServiceStageAction(
  _previousState: AdminUpdateState,
  formData: FormData,
): Promise<AdminUpdateState> {
  try {
    await createServiceStage(field(formData, "serviceId"), { name: field(formData, "name") });
  } catch (error) {
    return createFailure(error);
  }
  return finishCreate();
}

export async function renameServiceStageAction(
  _previousState: AdminUpdateState,
  formData: FormData,
): Promise<AdminUpdateState> {
  try {
    await renameServiceStage(field(formData, "id"), { name: field(formData, "name") });
  } catch (error) {
    return updateFailure(error);
  }
  return finishUpdate();
}

export async function moveServiceStageAction(formData: FormData): Promise<never> {
  const section = selectedSection(formData);
  try {
    await moveServiceStage(field(formData, "id"), field(formData, "direction"));
  } catch (error) {
    reportFailure("serviceStages", section, error);
  }
  return finish("serviceStages", "updated", section);
}

export async function deactivateServiceStageAction(formData: FormData): Promise<never> {
  const section = selectedSection(formData);
  try {
    await deactivateServiceStage(field(formData, "id"));
  } catch (error) {
    reportFailure("serviceStages", section, error);
  }
  return finish("serviceStages", "status", section);
}

export async function reactivateServiceStageAction(formData: FormData): Promise<never> {
  const section = selectedSection(formData);
  try {
    await reactivateServiceStage(field(formData, "id"));
  } catch (error) {
    reportFailure("serviceStages", section, error);
  }
  return finish("serviceStages", "status", section);
}
