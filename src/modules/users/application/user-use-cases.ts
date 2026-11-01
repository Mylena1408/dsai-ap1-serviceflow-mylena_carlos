import { requireConfigurationAdministrator } from "@/server/authorization";
import { ConflictError, NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { activeStateSchema, entityIdSchema } from "@/shared/validation";
import { roleRequiresSector, userCreationInputSchema, userUpdateInputSchema } from "./user-schemas";
import type { ManagedUser, UserRole, UserState } from "../domain/user";
import {
  assertAdministratorCanRetire,
  assertAttendantCanLeaveSector,
} from "../domain/user-rules";
import type {
  UserCommandDependencies,
  UserRepository,
  UserTransaction,
} from "./ports";

export async function listUsers(repository: UserRepository): Promise<ManagedUser[]> {
  await requireConfigurationAdministrator();

  return repository.listByName();
}

export async function createUser(
  input: unknown,
  { transactions, hashPassword }: UserCommandDependencies,
): Promise<ManagedUser> {
  await requireConfigurationAdministrator();
  const parsed = validateInput(userCreationInputSchema, input);
  const passwordHash = await hashPassword(parsed.password);

  return transactions.run(async (transaction) => {
    if (roleRequiresSector(parsed.role)) {
      await assertActiveSector(transaction, parsed.sectorId);
    }

    return transaction.create({
      name: parsed.name,
      email: parsed.email,
      passwordHash,
      role: parsed.role,
      sectorId: parsed.sectorId,
    });
  });
}

export async function updateUser(
  id: unknown,
  input: unknown,
  { transactions, hashPassword }: UserCommandDependencies,
): Promise<ManagedUser> {
  await requireConfigurationAdministrator();
  const userId = validateInput(entityIdSchema, id);
  const parsed = validateInput(userUpdateInputSchema, input);
  const passwordHash = parsed.password ? await hashPassword(parsed.password) : undefined;

  return transactions.run(async (transaction) => {
    const current = await transaction.findState(userId);

    if (!current) {
      throw new NotFoundError();
    }

    if (roleRequiresSector(parsed.role)) {
      await assertActiveSector(transaction, parsed.sectorId);
    }

    await checkAdministratorRetirement(
      transaction,
      current,
      parsed.role === "ADMIN" && current.isActive,
    );
    await checkAttendantSectorChange(transaction, current, {
      role: parsed.role,
      sectorId: parsed.sectorId,
      isActive: current.isActive,
    });

    return transaction.update(userId, {
      name: parsed.name,
      email: parsed.email,
      role: parsed.role,
      sectorId: parsed.sectorId,
      ...(passwordHash ? { passwordHash } : {}),
    });
  });
}

export async function setUserActive(
  id: unknown,
  isActive: unknown,
  { transactions }: Pick<UserCommandDependencies, "transactions">,
): Promise<ManagedUser> {
  await requireConfigurationAdministrator();
  const userId = validateInput(entityIdSchema, id);
  const active = validateInput(activeStateSchema, isActive);

  return transactions.run(async (transaction) => {
    const current = await transaction.findState(userId);

    if (!current) {
      throw new NotFoundError();
    }

    if (active && roleRequiresSector(current.role)) {
      await assertActiveSector(transaction, current.sectorId);
    }

    await checkAdministratorRetirement(transaction, current, active);
    await checkAttendantSectorChange(transaction, current, {
      role: current.role,
      sectorId: current.sectorId,
      isActive: active,
    });

    return transaction.update(userId, { isActive: active });
  });
}

async function assertActiveSector(
  transaction: UserTransaction,
  sectorId: string | null,
): Promise<void> {
  if (!sectorId) {
    throw new ConflictError();
  }

  const sector = await transaction.findSectorActivity(sectorId);

  if (!sector) {
    throw new NotFoundError();
  }

  if (!sector.isActive) {
    throw new ConflictError();
  }
}

async function checkAdministratorRetirement(
  transaction: UserTransaction,
  current: UserState,
  remainsActiveAdministrator: boolean,
): Promise<void> {
  if (current.role !== "ADMIN" || !current.isActive || remainsActiveAdministrator) {
    return;
  }

  assertAdministratorCanRetire({
    isActiveAdministrator: true,
    activeAdministratorCount: await transaction.countActiveAdministrators(),
    remainsActiveAdministrator,
  });
}

async function checkAttendantSectorChange(
  transaction: UserTransaction,
  current: UserState,
  next: { role: UserRole; sectorId: string | null; isActive: boolean },
): Promise<void> {
  if (current.role !== "ATTENDANT" || !current.isActive || !current.sectorId) {
    return;
  }

  const leavesSector =
    !next.isActive ||
    next.role !== "ATTENDANT" ||
    current.sectorId !== next.sectorId;

  if (!leavesSector) {
    return;
  }

  const [pendingRequests, otherActiveAttendants] = await Promise.all([
    transaction.countPendingRequestsInSector(current.sectorId),
    transaction.countOtherActiveAttendants(current.sectorId, current.id),
  ]);

  assertAttendantCanLeaveSector({
    isActiveAttendant: true,
    currentSectorId: current.sectorId,
    nextRole: next.role,
    nextSectorId: next.sectorId,
    nextIsActive: next.isActive,
    hasPendingRequests: pendingRequests > 0,
    otherActiveAttendantCount: otherActiveAttendants,
  });
}
