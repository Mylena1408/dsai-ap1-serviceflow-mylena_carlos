import { ConflictError } from "@/server/errors";

export function assertCategoryCanBeDeactivated(
  hasActiveService: boolean,
): void {
  if (hasActiveService) {
    throw new ConflictError();
  }
}
