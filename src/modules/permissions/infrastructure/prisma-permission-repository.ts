import type { Prisma, PrismaClient } from "@prisma/client";
import { organizationToday } from "@/server/authorization/effective-permissions";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import type { PermissionRepository, PermissionTransaction, PermissionTransactionRunner } from "../application/ports";

// DATE columns travel as midnight UTC instants; the domain uses "YYYY-MM-DD".
export const dayOf = (value: Date | null) => (value === null ? null : value.toISOString().slice(0, 10));
export const dateOf = (day: string | null) => (day === null ? null : new Date(`${day}T00:00:00.000Z`));

export function createPrismaPermissionRepository(database: PrismaClient): PermissionRepository {
  return {
    async listGrants() {
      const rows = await database.userPermission.findMany({
        select: { userId: true, permission: true, grantedAt: true, expiresOn: true },
        orderBy: [{ userId: "asc" }, { permission: "asc" }],
      });
      return rows.map((row) => ({ ...row, expiresOn: dayOf(row.expiresOn) }));
    },
    async listEvents() {
      const rows = await database.userPermissionEvent.findMany({
        select: {
          id: true,
          userId: true,
          permission: true,
          action: true,
          occurredAt: true,
          expiresOn: true,
          actor: { select: { id: true, name: true } },
        },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      });
      return rows.map((row) => ({ ...row, expiresOn: dayOf(row.expiresOn) }));
    },
    today: () => organizationToday(database),
  };
}

function createPrismaPermissionTransaction(transaction: Prisma.TransactionClient): PermissionTransaction {
  return {
    async currentTime() {
      // Same database clock as the request history (SPEC 2026-09-30, section 23).
      const [row] = await transaction.$queryRaw<Array<{ now: Date }>>`SELECT now() AS "now"`;
      return row.now;
    },
    today: () => organizationToday(transaction),
    findHolder(userId) {
      return transaction.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true, sectorId: true } });
    },
    async findGrant(userId, permission) {
      const grant = await transaction.userPermission.findUnique({
        where: { userId_permission: { userId, permission } },
        select: { expiresOn: true },
      });
      return grant && { expiresOn: dayOf(grant.expiresOn) };
    },
    async insertGrant(grant) {
      await transaction.userPermission.create({ data: { ...grant, expiresOn: dateOf(grant.expiresOn) } });
    },
    async renewGrant({ userId, permission, grantedById, grantedAt, expiresOn }) {
      await transaction.userPermission.update({
        where: { userId_permission: { userId, permission } },
        data: { grantedById, grantedAt, expiresOn: dateOf(expiresOn) },
      });
    },
    async deleteGrant(userId, permission) {
      await transaction.userPermission.delete({ where: { userId_permission: { userId, permission } } });
    },
    async insertEvent(event) {
      await transaction.userPermissionEvent.create({ data: { ...event, expiresOn: dateOf(event.expiresOn) } });
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
