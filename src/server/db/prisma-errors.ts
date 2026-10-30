import { Prisma } from "@prisma/client";
import {
  ConflictError,
  NotFoundError,
  type ApplicationError,
} from "@/server/errors";

export type TranslatedPrismaErrorCode = "P2002" | "P2003" | "P2025" | "P2034";

// Single source of Prisma → application error translation (SPEC 2026-10-27, section 7).
const translations: Record<TranslatedPrismaErrorCode, () => ApplicationError> = {
  P2002: () => new ConflictError(),
  P2003: () => new NotFoundError(),
  P2025: () => new NotFoundError(),
  P2034: () => new ConflictError(),
};

/**
 * Returns the application error for `error` when it is a known Prisma error whose
 * code is listed in `codes`. Each call site lists only the codes it translated
 * before the refactoring, so unlisted codes keep propagating unchanged.
 */
export function translatePrismaError(
  error: unknown,
  codes: readonly TranslatedPrismaErrorCode[],
): ApplicationError | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return undefined;
  }

  const code = codes.find((candidate) => candidate === error.code);

  return code ? translations[code]() : undefined;
}
