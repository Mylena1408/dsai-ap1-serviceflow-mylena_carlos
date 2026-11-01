import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import * as useCases from "./application/category-use-cases";
import type { CategoryRecord } from "./domain/category";
import {
  createPrismaCategoryRepository,
  createPrismaCategoryTransactionRunner,
} from "./infrastructure/prisma-category-repository";

export { assertCategoryCanBeDeactivated } from "./domain/deactivation";
export type { CategoryRecord } from "./domain/category";

export async function listCategories(database: PrismaClient = prisma): Promise<CategoryRecord[]> {
  return useCases.listCategories(createPrismaCategoryRepository(database));
}

export async function listCategoriesForCatalog(database: PrismaClient = prisma): Promise<CategoryRecord[]> {
  return useCases.listCategoriesForCatalog(createPrismaCategoryRepository(database));
}

export async function createCategory(
  input: unknown,
  database: PrismaClient = prisma,
): Promise<CategoryRecord> {
  return useCases.createCategory(input, createPrismaCategoryTransactionRunner(database));
}

export async function updateCategory(
  id: unknown,
  input: unknown,
  database: PrismaClient = prisma,
): Promise<CategoryRecord> {
  return useCases.updateCategory(id, input, createPrismaCategoryTransactionRunner(database));
}

export async function setCategoryActive(
  id: unknown,
  isActive: unknown,
  database: PrismaClient = prisma,
): Promise<CategoryRecord> {
  return useCases.setCategoryActive(id, isActive, createPrismaCategoryTransactionRunner(database));
}
