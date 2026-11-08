import type { Prisma, PrismaClient } from "@prisma/client";
import { recordOutboxEvent } from "@/modules/events";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import type { RequestTagReader, RequestTagStore, RequestTagTransaction } from "../application/request-tags";
import type { TagColor, TagRecord } from "../domain/tag";

// Tags on requests in PostgreSQL (SPEC 2026-11-08-atendimento-dia-a-dia, 3.4): the tags, their history and the
// event are written in one serializable transaction; the primary key keeps a tag once per request.

type Client = PrismaClient | Prisma.TransactionClient;

const tagColumns = { id: true, sectorId: true, name: true, color: true, isActive: true } as const;
const recordOf = (row: { id: string; sectorId: string; name: string; color: string; isActive: boolean }): TagRecord => ({ ...row, color: row.color as TagColor });

async function findRequest(client: Client, requestId: string) {
  const row = await client.request.findUnique({ where: { id: requestId }, select: { sectorId: true, status: true, tags: { select: { tagId: true } } } });
  return row && { sectorId: row.sectorId, status: row.status, tagIds: row.tags.map(({ tagId }) => tagId) };
}

export function createPrismaRequestTagReader(database: PrismaClient): RequestTagReader {
  return {
    findRequest: (requestId) => findRequest(database, requestId),
    async tagsOfRequests(requestIds) {
      if (requestIds.length === 0) return [];
      const rows = await database.requestTag.findMany({
        where: { requestId: { in: [...requestIds] } },
        orderBy: [{ tag: { name: "asc" } }, { tagId: "asc" }],
        select: { requestId: true, tag: { select: tagColumns } },
      });
      return rows.map((row) => ({ requestId: row.requestId, tag: recordOf(row.tag) }));
    },
    async tagsOf(requestId) {
      const rows = await database.requestTag.findMany({
        where: { requestId },
        orderBy: [{ tag: { name: "asc" } }, { tagId: "asc" }],
        select: { tag: { select: tagColumns } },
      });
      return rows.map(({ tag }) => recordOf(tag));
    },
    async activeTags(sectorId) {
      const rows = await database.sectorTag.findMany({ where: { sectorId, isActive: true }, orderBy: [{ name: "asc" }, { id: "asc" }], select: tagColumns });
      return rows.map(recordOf);
    },
    async events(requestId) {
      const rows = await database.requestTagEvent.findMany({
        where: { requestId },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        select: { id: true, occurredAt: true, action: true, tag: { select: { name: true } }, actor: { select: { name: true } } },
      });
      return rows.map((row) => ({ id: row.id, occurredAt: row.occurredAt, action: row.action, tagName: row.tag.name, actorName: row.actor.name }));
    },
  };
}

function transactionOf(client: Prisma.TransactionClient): RequestTagTransaction {
  return {
    findActor(userId) {
      return client.user.findUnique({ where: { id: userId }, select: { id: true, role: true, isActive: true, sectorId: true } });
    },
    findRequest: (requestId) => findRequest(client, requestId),
    async tagsByIds(tagIds) {
      if (tagIds.length === 0) return [];
      const rows = await client.sectorTag.findMany({ where: { id: { in: [...tagIds] } }, select: tagColumns });
      return rows.map(recordOf);
    },
    async currentTime() {
      const [{ now }] = await client.$queryRaw<Array<{ now: Date }>>`SELECT now() AS "now"`;
      return now;
    },
    async apply({ requestId, add, remove, actorId, occurredAt }) {
      if (remove.length > 0) await client.requestTag.deleteMany({ where: { requestId, tagId: { in: [...remove] } } });
      if (add.length > 0) await client.requestTag.createMany({ data: add.map((tagId) => ({ requestId, tagId, addedById: actorId, addedAt: occurredAt })) });
      await client.requestTagEvent.createMany({
        data: [
          ...add.map((tagId) => ({ requestId, tagId, action: "ADDED" as const, actorId, occurredAt })),
          ...remove.map((tagId) => ({ requestId, tagId, action: "REMOVED" as const, actorId, occurredAt })),
        ],
      });
      await recordOutboxEvent(client, { type: "request.tags_changed", requestId, occurredAt, payload: { actorId, added: add.length, removed: remove.length } });
    },
  };
}

export function createPrismaRequestTagStore(database: PrismaClient): RequestTagStore {
  return {
    run(work) {
      // Two changes at once: the primary key or the serialization refuses the second (a conflict).
      return runSerializableTransaction(database, (client) => work(transactionOf(client)), {
        translate: ["P2002", "P2025", "P2034"],
        fallbackMessage: "Request tag change failed.",
      });
    },
  };
}
