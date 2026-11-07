"use server";

import {
  createEscalationRule,
  createSector,
  deleteEscalationRule,
  setEscalationRuleActive,
  updateEscalationRule,
  setSectorActive,
  setSectorEscalation,
  updateSector,
} from "@/modules/sectors";
import {
  activeState,
  createFailure,
  escalationRuleFailureEntity,
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

// SPEC 2026-11-06-aprofundamento-configurabilidade, 7.3: the escalation rules of a sector.
function ruleSettings(formData: FormData) {
  return {
    name: field(formData, "name"),
    trigger: field(formData, "trigger"),
    overdueDays: field(formData, "overdueDays"),
    raisePriority: field(formData, "raisePriority") === "true",
    assignToId: field(formData, "assignToId"),
    notifyManagers: field(formData, "notifyManagers") === "true",
    notifyTeam: field(formData, "notifyTeam") === "true",
    notifyUserIds: formData.getAll("notifyUserIds").filter((value): value is string => typeof value === "string"),
  };
}

export async function createEscalationRuleAction(formData: FormData): Promise<never> {
  try {
    await createEscalationRule({ sectorId: field(formData, "sectorId"), ...ruleSettings(formData) });
  } catch (error) {
    reportFailure(escalationRuleFailureEntity(error), "sectors", error);
  }
  return finish("escalationRules", "created", "sectors");
}

export async function updateEscalationRuleAction(formData: FormData): Promise<never> {
  try {
    await updateEscalationRule(field(formData, "id"), ruleSettings(formData));
  } catch (error) {
    reportFailure(escalationRuleFailureEntity(error), "sectors", error);
  }
  return finish("escalationRules", "updated", "sectors");
}

export async function toggleEscalationRuleAction(formData: FormData): Promise<never> {
  try {
    await setEscalationRuleActive(field(formData, "id"), activeState(formData));
  } catch (error) {
    reportFailure("escalationRules", "sectors", error);
  }
  return finish("escalationRules", "status", "sectors");
}

export async function deleteEscalationRuleAction(formData: FormData): Promise<never> {
  try {
    await deleteEscalationRule(field(formData, "id"));
  } catch (error) {
    reportFailure("escalationRules", "sectors", error);
  }
  return finish("escalationRules", "deleted", "sectors");
}
