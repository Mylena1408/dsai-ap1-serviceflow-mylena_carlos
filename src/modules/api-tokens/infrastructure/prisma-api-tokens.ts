import type { Prisma, PrismaClient } from "@prisma/client";
import { createPrismaAuditScope } from "@/modules/audit";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import type {
  ApiCallStore,
  ApiTokenReader,
  ApiTokenRecord,
  ApiTokenTransaction,
  ApiTokenTransactionRunner,
} from "../application/ports";
import type { ApiTokenOwnerRole } from "../domain/token";

// Persistence of the API tokens (SPEC 2026-11-02-api-externa-webhooks, sections 5.1, 5.5 and 6).

const recordSelect = {
  id: true,
  name: true,
  scope: true,
  lastFour: true,
  createdAt: true,
  expiresAt: true,
  lastUsedAt: true,
  revokedAt: true,
  revokedBy: { select: { name: true } },
} satisfies Prisma.ApiTokenSelect;

type RecordRow = Prisma.ApiTokenGetPayload<{ select: typeof recordSelect }>;

function toRecord({ revokedBy, ...row }: RecordRow): ApiTokenRecord {
  return { ...row, revokedByName: revokedBy?.name ?? null };
}

/** Active first (newest first), then expired and revoked ones. */
const listOrder = [{ revokedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }, { id: "desc" }] satisfies Prisma.ApiTokenOrderByWithRelationInput[];

function createPrismaApiTokenTransaction(transaction: Prisma.TransactionClient): ApiTokenTransaction {
  return {
    ...createPrismaAuditScope(transaction),
    async currentTime() {
      const [row] = await transaction.$queryRaw<Array<{ now: Date }>>`SELECT now() AS "now"`;
      return row!.now;
    },
    async findOwner(userId) {
      const owner = await transaction.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, isActive: true, anonymizedAt: true },
      });
      return owner && { ...owner, role: owner.role as ApiTokenOwnerRole };
    },
    countActiveTokens(userId, now) {
      return transaction.apiToken.count({ where: { userId, revokedAt: null, expiresAt: { gt: now } } });
    },
    insertToken(token) {
      return transaction.apiToken.create({ data: token, select: { id: true } });
    },
    findToken(tokenId) {
      return transaction.apiToken.findUnique({ where: { id: tokenId }, select: { id: true, userId: true, revokedAt: true } });
    },
    revokeToken(tokenId, revokedById, at) {
      return transaction.apiToken.update({ where: { id: tokenId }, data: { revokedAt: at, revokedById }, select: { id: true } });
    },
  };
}

export function createPrismaApiTokenTransactionRunner(database: PrismaClient): ApiTokenTransactionRunner {
  return {
    run: (work) =>
      runSerializableTransaction(database, (transaction) => work(createPrismaApiTokenTransaction(transaction)), {
        translate: ["P2002", "P2025", "P2034"],
        fallbackMessage: "API token operation failed.",
      }),
  };
}

export function createPrismaApiTokenReader(database: PrismaClient): ApiTokenReader {
  return {
    async listOwn(userId) {
      const rows = await database.apiToken.findMany({ where: { userId }, select: recordSelect, orderBy: listOrder });
      return rows.map(toRecord);
    },
    async listAll() {
      const rows = await database.apiToken.findMany({
        select: { ...recordSelect, user: { select: { id: true, name: true, role: true } } },
        orderBy: listOrder,
      });
      return rows.map(({ user, ...row }) => ({ ...toRecord(row), owner: { ...user, role: user.role as ApiTokenOwnerRole } }));
    },
  };
}

export function createPrismaApiCallStore(database: PrismaClient): ApiCallStore {
  return {
    async findByHash(tokenHash) {
      const row = await database.apiToken.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          scope: true,
          expiresAt: true,
          revokedAt: true,
          lastUsedAt: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              sectorId: true,
              sector: { select: { name: true } },
              isActive: true,
              anonymizedAt: true,
            },
          },
        },
      });
      if (!row) return null;
      const { user, ...token } = row;
      const { sector, ...owner } = user;
      return { ...token, owner: { ...owner, sectorName: sector?.name ?? null, role: owner.role as ApiTokenOwnerRole } };
    },
    async countCall(tokenId, windowStart) {
      // One statement, so concurrent calls of the same token never lose a count.
      const [row] = await database.$queryRaw<Array<{ count: number }>>`
        INSERT INTO "ApiRateWindow" ("tokenId", "windowStart", "count")
        VALUES (${tokenId}::uuid, ${windowStart}, 1)
        ON CONFLICT ("tokenId", "windowStart") DO UPDATE SET "count" = "ApiRateWindow"."count" + 1
        RETURNING "count"`;
      return Number(row!.count);
    },
    async recordUse(tokenId, at) {
      await database.apiToken.update({ where: { id: tokenId }, data: { lastUsedAt: at } });
    },
  };
}

/** Call windows that started before `before` (retention, SPEC 2026-11-02-api-externa-webhooks, 5.7). */
export async function purgeApiRateWindows(database: PrismaClient, before: Date): Promise<number> {
  return (await database.apiRateWindow.deleteMany({ where: { windowStart: { lt: before } } })).count;
}

/** Tokens revoked or expired before `before` (5.7); their call windows go with them. */
export async function purgeEndedApiTokens(database: PrismaClient, before: Date): Promise<number> {
  const result = await database.apiToken.deleteMany({
    where: { OR: [{ revokedAt: { lt: before } }, { expiresAt: { lt: before } }] },
  });
  return result.count;
}
