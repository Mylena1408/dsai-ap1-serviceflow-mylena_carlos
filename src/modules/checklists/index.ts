import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import * as serviceChecklists from "./application/service-checklists";
import { createPrismaServiceChecklistReader, createPrismaServiceChecklistStore } from "./infrastructure/prisma-service-checklists";
import * as requestChecklist from "./application/request-checklist";
import { createPrismaRequestChecklistReader, createPrismaRequestChecklistStore } from "./infrastructure/prisma-request-checklist";

// Attendance checklists (SPEC 2026-11-08-atendimento-dia-a-dia, part B): the rules (SF-200) and the services'
// models (SF-201) and the requests' checklists (SF-203).
export {
  ChecklistPendingError,
  MAX_ACTIVE_CHECKLIST_ITEMS,
  MAX_CHECKLIST_CONDITION_LENGTH,
  MAX_CHECKLIST_NOTE_LENGTH,
  MAX_CHECKLIST_TEXT_LENGTH,
  assertChecklistAllowsCompletion,
  assertChecklistRoom,
  canManageServiceChecklist,
  checklistConditionSchema,
  checklistItemInputSchema,
  checklistItemTextSchema,
  checklistMarkInputSchema,
  checklistProgress,
  checklistProgressLabel,
  pendingRequiredItems,
  planChecklistCopy,
  planChecklistMark,
  planModelCopy,
} from "./domain/checklist";
export type {
  ChecklistActor,
  ChecklistAnswer,
  ChecklistCondition,
  ChecklistItemInput,
  ChecklistItemText,
  ChecklistMarkInput,
  ChecklistMarkPlan,
  ChecklistRequestStatus,
  ChecklistTemplateItem,
  RequestChecklistItemRecord,
} from "./domain/checklist";
export type { ChecklistConditionField, ServiceChecklist } from "./application/service-checklists";
export type { RequestChecklistEventView, RequestChecklistItemView, RequestChecklistView } from "./application/request-checklist";

export function listServiceChecklists(database: PrismaClient = prisma): Promise<serviceChecklists.ServiceChecklist[]> {
  return serviceChecklists.listServiceChecklists(createPrismaServiceChecklistReader(database));
}

export function createChecklistItem(serviceId: unknown, input: unknown, database: PrismaClient = prisma) {
  return serviceChecklists.createChecklistItem(serviceId, input, createPrismaServiceChecklistStore(database));
}

export function updateChecklistItem(itemId: unknown, input: unknown, database: PrismaClient = prisma) {
  return serviceChecklists.updateChecklistItem(itemId, input, createPrismaServiceChecklistStore(database));
}

export function moveChecklistItem(itemId: unknown, direction: unknown, database: PrismaClient = prisma) {
  return serviceChecklists.moveChecklistItem(itemId, direction, createPrismaServiceChecklistStore(database));
}

export function setChecklistItemActive(itemId: unknown, isActive: unknown, database: PrismaClient = prisma) {
  return serviceChecklists.setChecklistItemActive(itemId, isActive, createPrismaServiceChecklistStore(database));
}

export function setChecklistItemCondition(itemId: unknown, input: unknown, database: PrismaClient = prisma) {
  return serviceChecklists.setChecklistItemCondition(itemId, input, createPrismaServiceChecklistStore(database));
}

// A request's checklist (SPEC 2026-11-08-atendimento-dia-a-dia, 4.3 item 3 and 13.1 item 4).
export function getRequestChecklist(requestId: unknown, database: PrismaClient = prisma): Promise<requestChecklist.RequestChecklistView> {
  return requestChecklist.getRequestChecklist(requestId, createPrismaRequestChecklistReader(database));
}

export function markChecklistItem(input: unknown, database: PrismaClient = prisma) {
  return requestChecklist.markChecklistItem(input, createPrismaRequestChecklistStore(database));
}
