import { Prisma, type PrismaClient } from "@prisma/client";
import {
  translatePrismaError,
  type TranslatedPrismaErrorCode,
} from "./prisma-errors";

export interface PersistenceErrorPolicy {
  /** Prisma codes this operation translated before the refactoring. */
  translate: readonly TranslatedPrismaErrorCode[];
  /** Message for thrown values that are not `Error` instances. */
  fallbackMessage: string;
}

/** Rethrows `error` translated by `policy`, keeping the pre-refactoring behavior. */
export function rethrowPersistenceError(error: unknown, policy: PersistenceErrorPolicy): never {
  const translated = translatePrismaError(error, policy.translate);

  if (translated) {
    throw translated;
  }

  throw error instanceof Error ? error : new Error(policy.fallbackMessage);
}

/**
 * Runs `work` in a Serializable transaction and translates persistence errors. `timeoutMs`
 * raises Prisma's default limit (5 s) for work that also waits on an external service.
 */
export async function runSerializableTransaction<T>(
  database: PrismaClient,
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
  policy: PersistenceErrorPolicy,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  try {
    return await database.$transaction(work, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
    });
  } catch (error) {
    rethrowPersistenceError(error, policy);
  }
}
