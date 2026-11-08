import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import * as useCases from "./application/saved-views";
import { createPrismaSavedViewStore } from "./infrastructure/prisma-saved-views";

// Saved views of the queue and of "Minhas solicitações" (SPEC 2026-11-07-operacao-e-automacao, part E).
export {
  LIST_PARAMETERS,
  LIST_PATHS,
  MAX_CRITERIA_LENGTH,
  MAX_VIEWS_PER_LIST,
  MAX_VIEW_NAME_LENGTH,
  SAVED_VIEW_LISTS,
  normalizedCriteria,
  viewHref,
  type SavedViewList,
  type SavedViewRecord,
} from "./domain/saved-view";

const store = (database: PrismaClient) => createPrismaSavedViewStore(database);

export function listSavedViews(list: unknown, database: PrismaClient = prisma) {
  return useCases.listSavedViews(list, store(database));
}

export function saveView(input: unknown, database: PrismaClient = prisma) {
  return useCases.saveView(input, store(database));
}

export function renameView(viewId: unknown, name: unknown, database: PrismaClient = prisma) {
  return useCases.renameView(viewId, name, store(database));
}

export function deleteView(viewId: unknown, database: PrismaClient = prisma) {
  return useCases.deleteView(viewId, store(database));
}
