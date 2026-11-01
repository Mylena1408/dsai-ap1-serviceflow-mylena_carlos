import { requireCatalogEditor, requireConfigurationAdministrator } from "@/server/authorization";
import { NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { activeStateSchema, entityIdSchema } from "@/shared/validation";
import { categoryInputSchema } from "./category-schemas";
import type { CategoryRecord } from "../domain/category";
import { assertCategoryCanBeDeactivated } from "../domain/deactivation";
import type { CategoryRepository, CategoryTransactionRunner } from "./ports";

export async function listCategories(repository: CategoryRepository): Promise<CategoryRecord[]> {
  await requireConfigurationAdministrator();

  return repository.listByName();
}

// Category choices for the service form of a catalog editor (SPEC de permissões, 5.3.1).
export async function listCategoriesForCatalog(repository: CategoryRepository): Promise<CategoryRecord[]> {
  await requireCatalogEditor();

  return repository.listByName();
}

export async function createCategory(
  input: unknown,
  transactions: CategoryTransactionRunner,
): Promise<CategoryRecord> {
  await requireConfigurationAdministrator();
  const { name } = validateInput(categoryInputSchema, input);

  return transactions.run((transaction) => transaction.create(name));
}

export async function updateCategory(
  id: unknown,
  input: unknown,
  transactions: CategoryTransactionRunner,
): Promise<CategoryRecord> {
  await requireConfigurationAdministrator();
  const categoryId = validateInput(entityIdSchema, id);
  const { name } = validateInput(categoryInputSchema, input);

  return transactions.run(async (transaction) => {
    if (!(await transaction.exists(categoryId))) {
      throw new NotFoundError();
    }

    return transaction.update(categoryId, { name });
  });
}

export async function setCategoryActive(
  id: unknown,
  isActive: unknown,
  transactions: CategoryTransactionRunner,
): Promise<CategoryRecord> {
  await requireConfigurationAdministrator();
  const categoryId = validateInput(entityIdSchema, id);
  const active = validateInput(activeStateSchema, isActive);

  return transactions.run(async (transaction) => {
    if (!(await transaction.exists(categoryId))) {
      throw new NotFoundError();
    }

    if (!active) {
      assertCategoryCanBeDeactivated(await transaction.hasActiveService(categoryId));
    }

    return transaction.update(categoryId, { isActive: active });
  });
}
