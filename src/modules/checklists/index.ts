import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import * as serviceChecklists from "./application/service-checklists";
import { createPrismaServiceChecklistReader, createPrismaServiceChecklistStore } from "./infrastructure/prisma-service-checklists";

// Attendance checklists (SPEC 2026-11-08-atendimento-dia-a-dia, part B): the rules (SF-200) and the services'
// models (SF-201).
export {
  MAX_ACTIVE_CHECKLIST_ITEMS,
  MAX_CHECKLIST_CONDITION_LENGTH,
  MAX_CHECKLIST_NOTE_LENGTH,
  MAX_CHECKLIST_TEXT_LENGTH,
  assertChecklistAllowsCompletion,
  assertChecklistRoom,
  canManageServiceChecklist,
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
  ChecklistItemInput,
  ChecklistItemText,
  ChecklistMarkInput,
  ChecklistMarkPlan,
  ChecklistRequestStatus,
  ChecklistTemplateItem,
  RequestChecklistItemRecord,
} from "./domain/checklist";
export type { ServiceChecklist } from "./application/service-checklists";

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
