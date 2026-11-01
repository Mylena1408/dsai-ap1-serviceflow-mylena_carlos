import type { Prisma, PrismaClient } from "@prisma/client";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import type { PermissionRepository, PermissionTransaction, PermissionTransactionRunner } from "../application/ports";

export function createPrismaPermissionRepository(database: PrismaClient): PermissionRepository {
  return {
    listGrants() {
      return database.userPermission.findMany({
        select: { userId: true, permission: true, grantedAt: true },
        orderBy: [{ userId: "asc" }, { permission: "asc" }],
      });
    },
    listEvents() {
      return database.userPermissionEvent.findMany({
        select: {
          id: true,
          userId: true,
          permission: true,
          action: true,
          occurredAt: true,
          actor: { select: { id: true, name: true } },
        },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      });
    },
  };
}

function createPrismaPermissionTransaction(transaction: Prisma.TransactionClient): PermissionTransaction {
  return {
    async currentTime() {
      // Same database clock as the request history (SPEC 2026-09-30, section 23).
      const [row] = await transaction.$queryRaw<Array<{ now: Date }>>`SELECT now() AS "now"`;
      return row.now;
    },
    findHolder(userId) {
      return transaction.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true, sectorId: true } });
    },
    async hasGrant(userId, permission) {
      const grant = await transaction.userPermission.findUnique({
        where: { userId_permission: { userId, permission } },
        select: { id: true },
      });
      return grant !== null;
    },
    async insertGrant(grant) {
      await transaction.userPermission.create({ data: grant });
    },
    async deleteGrant(userId, permission) {
      await transaction.userPermission.delete({ where: { userId_permission: { userId, permission } } });
    },
    async insertEvent(event) {
      await transaction.userPermissionEvent.create({ data: event });
    },
  };
}

export function createPrismaPermissionTransactionRunner(database: PrismaClient): PermissionTransactionRunner {
  return {
    run(work) {
      return runSerializableTransaction(database, (transaction) => work(createPrismaPermissionTransaction(transaction)), {
        translate: ["P2002", "P2025", "P2003"],
        fallbackMessage: "Permission operation failed.",
      });
    },
  };
}
