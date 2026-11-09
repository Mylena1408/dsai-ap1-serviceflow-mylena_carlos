import type { Prisma, PrismaClient } from "@prisma/client";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import type { FollowerReader, FollowerStore, FollowerTransaction } from "../application/followers";

// Followers in PostgreSQL (SPEC 2026-11-08-atendimento-dia-a-dia, 6.4): the key refuses following twice; every change
// writes the history in the same transaction.

type Client = PrismaClient | Prisma.TransactionClient;

const person = { id: true, role: true, isActive: true, sectorId: true } as const;

function findRequest(client: Client, requestId: string) {
  return client.request.findUnique({ where: { id: requestId }, select: { requesterId: true, sectorId: true } });
}

function transactionOf(client: Prisma.TransactionClient): FollowerTransaction {
  return {
    findActor: (userId) => client.user.findUnique({ where: { id: userId }, select: person }),
    findRequest: (requestId) => findRequest(client, requestId),
    findByEmail: (email) => client.user.findUnique({ where: { email }, select: person }),
    findPerson: (userId) => client.user.findUnique({ where: { id: userId }, select: person }),
    async listFollowers(requestId) {
      const rows = await client.requestFollower.findMany({ where: { requestId }, select: { userId: true, user: { select: { role: true } } } });
      return rows.map(({ userId, user }) => ({ userId, role: user.role }));
    },
    async currentTime() {
      const [row] = await client.$queryRaw<Array<{ now: Date }>>`SELECT now() AS "now"`;
      return row.now;
    },
    async add({ requestId, userId, addedById, at }) {
      await client.requestFollower.create({ data: { requestId, userId, addedById, createdAt: at } });
      await client.requestFollowerEvent.create({ data: { requestId, userId, action: "ADDED", actorId: addedById, occurredAt: at } });
    },
    async remove({ requestId, userId, actorId, at }) {
      await client.requestFollower.delete({ where: { requestId_userId: { requestId, userId } } });
      await client.requestFollowerEvent.create({ data: { requestId, userId, action: "REMOVED", actorId, occurredAt: at } });
    },
  };
}

export function createPrismaFollowerStore(database: PrismaClient): FollowerStore {
  return {
    run(work) {
      return runSerializableTransaction(database, (client) => work(transactionOf(client)), {
        translate: ["P2002", "P2025", "P2034"],
        fallbackMessage: "Follower change failed.",
      });
    },
  };
}

export function createPrismaFollowerReader(database: PrismaClient): FollowerReader {
  return {
    findRequest: (requestId) => findRequest(database, requestId),
    async followers(requestId) {
      const rows = await database.requestFollower.findMany({
        where: { requestId },
        orderBy: [{ createdAt: "asc" }, { userId: "asc" }],
        select: { userId: true, user: { select: { name: true, role: true } } },
      });
      return rows.map(({ userId, user }) => ({ userId, name: user.name, role: user.role, kind: user.role === "REQUESTER" ? ("colleague" as const) : ("attendant" as const) }));
    },
    async events(requestId) {
      const rows = await database.requestFollowerEvent.findMany({
        where: { requestId },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        select: { id: true, occurredAt: true, action: true, user: { select: { name: true } }, actor: { select: { name: true } } },
      });
      return rows.map((row) => ({ id: row.id, occurredAt: row.occurredAt, action: row.action, userName: row.user.name, actorName: row.actor.name }));
    },
    async reading(requestId) {
      const [comments, answers, documents] = await Promise.all([
        // Public comments only, never the team's internal notes (6.3 item 2).
        database.requestComment.findMany({
          where: { requestId, isInternal: false },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { id: true, body: true, createdAt: true, author: { select: { name: true } } },
        }),
        // The requester's form only; the attendance's fields are the team's.
        database.requestFieldValue.findMany({
          where: { requestId, field: { audience: "REQUESTER" } },
          orderBy: [{ positionSnapshot: "asc" }, { id: "asc" }],
          select: { labelSnapshot: true, typeSnapshot: true, value: true },
        }),
        database.requestAttachment.findMany({
          where: { requestId },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { requirementNameSnapshot: true, detectedFormat: true, sizeBytes: true, removedAt: true },
        }),
      ]);
      return {
        comments: comments.map(({ author, ...comment }) => ({ ...comment, authorName: author.name })),
        answers: answers.map((row) => ({ label: row.labelSnapshot, type: row.typeSnapshot, value: row.value })),
        documents: documents.map((row) => ({ name: row.requirementNameSnapshot, format: row.detectedFormat, sizeBytes: row.sizeBytes, removed: row.removedAt !== null })),
      };
    },
  };
}
