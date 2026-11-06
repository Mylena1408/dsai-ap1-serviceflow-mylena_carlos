import type { PrismaClient } from "@prisma/client";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import type { CannedResponseRecord, CannedResponseRepository } from "../application/canned-responses";

// Persistence of the canned responses (SPEC 2026-11-06-respostas-prontas, 5). A repeated active
// title violates the partial unique index (P2002), which becomes a conflict.

const policy = { translate: ["P2002", "P2025", "P2034"] as const, fallbackMessage: "Canned response change failed." };

const select = {
  id: true,
  sectorId: true,
  title: true,
  body: true,
  isActive: true,
  updatedAt: true,
  createdBy: { select: { name: true } },
  updatedBy: { select: { name: true } },
} as const;

type Row = {
  id: string;
  sectorId: string;
  title: string;
  body: string;
  isActive: boolean;
  updatedAt: Date;
  createdBy: { name: string };
  updatedBy: { name: string };
};

function record(row: Row): CannedResponseRecord {
  return {
    id: row.id,
    sectorId: row.sectorId,
    title: row.title,
    body: row.body,
    isActive: row.isActive,
    createdByName: row.createdBy.name,
    updatedByName: row.updatedBy.name,
    updatedAt: row.updatedAt,
  };
}

export function createPrismaCannedResponseRepository(database: PrismaClient): CannedResponseRepository {
  return {
    findAttendant(userId) {
      return database.user.findUnique({ where: { id: userId }, select: { id: true, name: true, role: true, isActive: true, sectorId: true } });
    },
    async findRequest(requestId) {
      const row = await database.request.findUnique({
        where: { id: requestId },
        select: { id: true, sectorId: true, serviceNameSnapshot: true, requester: { select: { name: true } } },
      });
      return row && { id: row.id, sectorId: row.sectorId, requesterName: row.requester.name, serviceName: row.serviceNameSnapshot };
    },
    async listForSector(sectorId) {
      return (await database.cannedResponse.findMany({ where: { sectorId }, select })).map(record);
    },
    async find(id) {
      const row = await database.cannedResponse.findUnique({ where: { id }, select });
      return row && record(row);
    },
    create(input) {
      return runSerializableTransaction(
        database,
        async (transaction) => {
          const [{ now }] = await transaction.$queryRaw<Array<{ now: Date }>>`SELECT now() AS "now"`;
          const row = await transaction.cannedResponse.create({
            data: {
              sectorId: input.sectorId,
              title: input.title,
              body: input.body,
              createdById: input.actorId,
              updatedById: input.actorId,
              createdAt: now,
              updatedAt: now,
            },
            select,
          });
          return record(row);
        },
        policy,
      );
    },
    update(id, input) {
      return runSerializableTransaction(
        database,
        async (transaction) => {
          const [{ now }] = await transaction.$queryRaw<Array<{ now: Date }>>`SELECT now() AS "now"`;
          await transaction.cannedResponse.update({
            where: { id },
            data: { title: input.title, body: input.body, updatedById: input.actorId, updatedAt: now },
          });
        },
        policy,
      );
    },
    setActive(id, isActive, actorId) {
      return runSerializableTransaction(
        database,
        async (transaction) => {
          const [{ now }] = await transaction.$queryRaw<Array<{ now: Date }>>`SELECT now() AS "now"`;
          await transaction.cannedResponse.update({ where: { id }, data: { isActive, updatedById: actorId, updatedAt: now } });
        },
        policy,
      );
    },
  };
}
