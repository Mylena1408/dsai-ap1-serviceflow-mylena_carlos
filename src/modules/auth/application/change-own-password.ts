import { requireCurrentActor } from "@/server/authorization";
import { AuthenticationError, ConflictError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { ownPasswordChangeInputSchema } from "@/shared/validation";
import type { AuthUserRepository, PasswordHasher } from "./ports";

export class CurrentPasswordMismatchError extends Error {
  constructor() {
    super("Current password verification failed.");
    this.name = "CurrentPasswordMismatchError";
  }
}

export async function changeOwnPassword(
  input: unknown,
  users: AuthUserRepository,
  passwords: PasswordHasher,
): Promise<void> {
  const actor = await requireCurrentActor();
  const parsed = validateInput(ownPasswordChangeInputSchema, input);

  const user = await users.findPasswordState(actor.id);

  if (!user?.isActive) {
    throw new AuthenticationError();
  }

  if (!(await passwords.verify(user.passwordHash, parsed.currentPassword))) {
    throw new CurrentPasswordMismatchError();
  }

  const newHash = await passwords.hash(parsed.newPassword);
  const changed = await users.replacePasswordHash({
    userId: actor.id,
    expectedHash: user.passwordHash,
    newHash,
  });

  if (changed !== 1) {
    throw new ConflictError();
  }
}
