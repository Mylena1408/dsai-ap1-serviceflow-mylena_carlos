import type { CategoryRecord } from "../domain/category";

export interface CategoryRepository {
  listByName(): Promise<CategoryRecord[]>;
}

/** Operations available inside a category transaction. */
export interface CategoryTransaction {
  exists(categoryId: string): Promise<boolean>;
  create(name: string): Promise<CategoryRecord>;
  update(categoryId: string, data: { name?: string; isActive?: boolean }): Promise<CategoryRecord>;
  hasActiveService(categoryId: string): Promise<boolean>;
}

/** Runs work atomically with serializable isolation. */
export interface CategoryTransactionRunner {
  run<T>(work: (transaction: CategoryTransaction) => Promise<T>): Promise<T>;
}
