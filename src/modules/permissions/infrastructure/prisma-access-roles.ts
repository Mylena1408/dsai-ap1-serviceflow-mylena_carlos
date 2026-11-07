import type { Prisma, PrismaClient } from "@prisma/client";
import { createPrismaAuditScope } from "@/modules/audit";
import { organizationToday } from "@/server/authorization/effective-permissions";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import type { AccessRoleRepository, AccessRoleTransaction, AccessRoleTransactionRunner } from "../application/ports";
import { orderedPermissions, type AccessRoleRecord } from "../domain/access-role";
import { dateOf, dayOf } from "./prisma-permission-repository";

// Roles and their assignments in PostgreSQL (SPEC 2026-11-06-aprofundamento-configurabilidade, 6.4).

const roleColumns = { id: true, name: true, description: true, permissions: true, isActive: true } as const;

const roleOf = (row: AccessRoleRecord): AccessRoleRecord => ({ ...row, permissions: orderedPermissions(row.permissions) });

export function createPrismaAccessRoleRepository(database: PrismaClient): AccessRoleRepository {
  return {
    async listRoles() {
      const rows = await database.accessRole.findMany({
        select: { ...roleColumns, _count: { select: { assignments: true } } },
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
      });
      return rows.map(({ _count, ...row }) => ({ ...roleOf(row), assignmentCount: _count.assignments }));
    },
    async listAssignments() {
      const rows = await database.userAccessRole.findMany({
        select: { userId: true, roleId: true, assignedAt: true, expiresOn: true },
        orderBy: [{ userId: "asc" }, { assignedAt: "asc" }],
      });
      return rows.map((row) => ({ ...row, expiresOn: dayOf(row.expiresOn) }));
    },
    async listEvents() {
      const rows = await database.userAccessRoleEvent.findMany({
        select: {
          id: true,
          userId: true,
          action: true,
          occurredAt: true,
          expiresOn: true,
          role: { select: { id: true, name: true } },
          actor: { select: { id: true, name: true } },
        },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      });
      return rows.map((row) => ({ ...row, expiresOn: dayOf(row.expiresOn) }));
    },
    today: () => organizationToday(database),
  };
}

function createPrismaAccessRoleTransaction(transaction: Prisma.TransactionClient): AccessRoleTransaction {
  return {
    ...createPrismaAuditScope(transaction),
    async currentTime() {
      const [row] = await transaction.$queryRaw<Array<{ now: Date }>>`SELECT now() AS "now"`;
      return row.now;
    },
    today: () => organizationToday(transaction),
    async findRole(roleId) {
      const row = await transaction.accessRole.findUnique({ where: { id: roleId }, select: roleColumns });
      return row && roleOf(row);
    },
    async createRole(input) {
      return roleOf(await transaction.accessRole.create({ data: input, select: roleColumns }));
    },
    async updateRole(roleId, data) {
      return roleOf(await transaction.accessRole.update({ where: { id: roleId }, data, select: roleColumns }));
    },
    findHolder(userId) {
      return transaction.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true, sectorId: true } });
    },
    async findAssignment(userId, roleId) {
      const row = await transaction.userAccessRole.findUnique({
        where: { userId_roleId: { userId, roleId } },
        select: { expiresOn: true },
      });
      return row && { expiresOn: dayOf(row.expiresOn) };
    },
    async saveAssignment({ userId, roleId, assignedById, assignedAt, expiresOn }) {
      const values = { assignedById, assignedAt, expiresOn: dateOf(expiresOn) };
      await transaction.userAccessRole.upsert({
        where: { userId_roleId: { userId, roleId } },
        create: { userId, roleId, ...values },
        update: values,
      });
    },
    async deleteAssignment(userId, roleId) {
      await transaction.userAccessRole.delete({ where: { userId_roleId: { userId, roleId } } });
    },
    async insertEvent(event) {
      await transaction.userAccessRoleEvent.create({ data: { ...event, expiresOn: dateOf(event.expiresOn) } });
    },
  };
}

export function createPrismaAccessRoleTransactionRunner(database: PrismaClient): AccessRoleTransactionRunner {
  return {
    run(work) {
      return runSerializableTransaction(database, (transaction) => work(createPrismaAccessRoleTransaction(transaction)), {
        // A repeated active name: the partial unique index refuses it (6.3.1).
        translate: ["P2002", "P2025", "P2003"],
        fallbackMessage: "Access role operation failed.",
      });
    },
  };
}
