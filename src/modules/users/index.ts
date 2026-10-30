import {
  Prisma,
  type PrismaClient,
  type Role,
  type User,
} from "@prisma/client";
import { requireConfigurationAdministrator } from "@/server/authorization";
import {
  ConflictError,
  NotFoundError,
} from "@/server/errors";
import { prisma } from "@/server/db";
import {
  activeStateSchema,
  entityIdSchema,
  userCreationInputSchema,
  userUpdateInputSchema,
} from "@/shared/validation";
import { validateInput } from "@/server/validation";
import { hashPassword } from "@/modules/auth";
import {
  assertAdministratorCanRetire,
  assertAttendantCanLeaveSector,
} from "./policy";

export {
  assertAdministratorCanRetire,
  assertAttendantCanLeaveSector,
} from "./policy";

const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  sectorId: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export type ManagedUser = Prisma.UserGetPayload<{
  select: typeof publicUserSelect;
}>;

export async function listUsers(
  database: PrismaClient = prisma,
): Promise<ManagedUser[]> {
  await requireConfigurationAdministrator();

  return database.user.findMany({
    select: publicUserSelect,
    orderBy: [{ name: "asc" }, { email: "asc" }],
  });
}

export async function createUser(
  input: unknown,
  database: PrismaClient = prisma,
): Promise<ManagedUser> {
  await requireConfigurationAdministrator();
  const parsed = validateInput(userCreationInputSchema, input);
  const passwordHash = await hashPassword(parsed.password);

  try {
    return await database.$transaction(
      async (transaction) => {
        if (parsed.role === "ATTENDANT") {
          await assertActiveSector(transaction, parsed.sectorId);
        }

        return transaction.user.create({
          data: {
            name: parsed.name,
            email: parsed.email,
            passwordHash,
            role: parsed.role,
            sectorId: parsed.sectorId,
          },
          select: publicUserSelect,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    throw mapUserPersistenceError(error);
  }
}

export async function updateUser(
  id: unknown,
  input: unknown,
  database: PrismaClient = prisma,
): Promise<ManagedUser> {
  await requireConfigurationAdministrator();
  const userId = validateInput(entityIdSchema, id);
  const parsed = validateInput(userUpdateInputSchema, input);
  const passwordHash = parsed.password
    ? await hashPassword(parsed.password)
    : undefined;

  try {
    return await database.$transaction(
      async (transaction) => {
        const current = await transaction.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            role: true,
            sectorId: true,
            isActive: true,
          },
        });

        if (!current) {
          throw new NotFoundError();
        }

        if (parsed.role === "ATTENDANT") {
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

        return transaction.user.update({
          where: { id: userId },
          data: {
            name: parsed.name,
            email: parsed.email,
            role: parsed.role,
            sectorId: parsed.sectorId,
            ...(passwordHash ? { passwordHash } : {}),
          },
          select: publicUserSelect,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    throw mapUserPersistenceError(error);
  }
}

export async function setUserActive(
  id: unknown,
  isActive: unknown,
  database: PrismaClient = prisma,
): Promise<ManagedUser> {
  await requireConfigurationAdministrator();
  const userId = validateInput(entityIdSchema, id);
  const active = validateInput(activeStateSchema, isActive);

  try {
    return await database.$transaction(
      async (transaction) => {
        const current = await transaction.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            role: true,
            sectorId: true,
            isActive: true,
          },
        });

        if (!current) {
          throw new NotFoundError();
        }

        if (active && current.role === "ATTENDANT") {
          await assertActiveSector(transaction, current.sectorId);
        }

        await checkAdministratorRetirement(transaction, current, active);
        await checkAttendantSectorChange(transaction, current, {
          role: current.role,
          sectorId: current.sectorId,
          isActive: active,
        });

        return transaction.user.update({
          where: { id: userId },
          data: { isActive: active },
          select: publicUserSelect,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    throw mapUserPersistenceError(error);
  }
}

async function assertActiveSector(
  transaction: Prisma.TransactionClient,
  sectorId: string | null,
): Promise<void> {
  if (!sectorId) {
    throw new ConflictError();
  }

  const sector = await transaction.sector.findUnique({
    where: { id: sectorId },
    select: { isActive: true },
  });

  if (!sector) {
    throw new NotFoundError();
  }

  if (!sector.isActive) {
    throw new ConflictError();
  }
}

async function checkAdministratorRetirement(
  transaction: Prisma.TransactionClient,
  current: Pick<User, "id" | "role" | "isActive">,
  remainsActiveAdministrator: boolean,
): Promise<void> {
  if (current.role !== "ADMIN" || !current.isActive || remainsActiveAdministrator) {
    return;
  }

  const activeAdministratorCount = await transaction.user.count({
    where: { role: "ADMIN", isActive: true },
  });

  assertAdministratorCanRetire({
    isActiveAdministrator: true,
    activeAdministratorCount,
    remainsActiveAdministrator,
  });
}

async function checkAttendantSectorChange(
  transaction: Prisma.TransactionClient,
  current: Pick<User, "id" | "role" | "sectorId" | "isActive">,
  next: { role: Role; sectorId: string | null; isActive: boolean },
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
    transaction.request.count({
      where: {
        sectorId: current.sectorId,
        status: { in: ["OPEN", "IN_PROGRESS"] },
      },
    }),
    transaction.user.count({
      where: {
        id: { not: current.id },
        role: "ATTENDANT",
        sectorId: current.sectorId,
        isActive: true,
      },
    }),
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

function mapUserPersistenceError(error: unknown): Error {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return new ConflictError();
  }

  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2025" || error.code === "P2003")
  ) {
    return new NotFoundError();
  }

  return error instanceof Error ? error : new Error("User operation failed.");
}
