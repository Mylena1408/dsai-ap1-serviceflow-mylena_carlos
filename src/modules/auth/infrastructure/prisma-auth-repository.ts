import { Prisma, type PrismaClient } from "@prisma/client";
import { translatePrismaError } from "@/server/db/prisma-errors";
import type {
  AdministratorBootstrapStore,
  AdministratorBootstrapTransaction,
  AuthUserRepository,
} from "../application/ports";

export function createPrismaAuthUserRepository(database: PrismaClient): AuthUserRepository {
  return {
    findCredentialUserByEmail(email) {
      return database.user.findUnique({
        where: { email },
        select: { id: true, name: true, email: true, passwordHash: true, isActive: true },
      });
    },
    findSessionUser(userId) {
      return database.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true, role: true, sectorId: true, isActive: true },
      });
    },
    findPasswordState(userId) {
      return database.user.findUnique({
        where: { id: userId },
        select: { passwordHash: true, isActive: true },
      });
    },
    async replacePasswordHash({ userId, expectedHash, newHash }) {
      const result = await database.user.updateMany({
        where: { id: userId, passwordHash: expectedHash, isActive: true },
        data: { passwordHash: newHash },
      });
      return result.count;
    },
  };
}

function createBootstrapTransaction(
  transaction: Prisma.TransactionClient,
): AdministratorBootstrapTransaction {
  return {
    countAdministrators() {
      return transaction.user.count({ where: { role: "ADMIN" } });
    },
    createAdministrator({ name, email, passwordHash }) {
      return transaction.user.create({
        data: { name, email, role: "ADMIN", sectorId: null, passwordHash, isActive: true },
        select: { id: true, name: true, email: true },
      });
    },
  };
}

export function createPrismaAdministratorBootstrapStore(
  database: PrismaClient,
): AdministratorBootstrapStore {
  const countAdministrators = () => database.user.count({ where: { role: "ADMIN" } });

  return {
    countAdministrators,
    async run(work) {
      try {
        return await database.$transaction(
          (transaction) => work(createBootstrapTransaction(transaction)),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        // A serialization failure (P2034) is a conflict only when another administrator now
        // exists; any other error propagates unchanged, as before the refactoring.
        const conflict = translatePrismaError(error, ["P2034"]);

        if (conflict && (await countAdministrators())) {
          throw conflict;
        }

        throw error;
      }
    },
  };
}
