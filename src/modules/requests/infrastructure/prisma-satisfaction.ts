import type { Prisma, PrismaClient } from "@prisma/client";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import type { SatisfactionStore, SatisfactionTransaction } from "../application/satisfaction";

// Persistence of the satisfaction survey (SPEC 2026-11-06-pesquisa-satisfacao, 5): one row per
// request, replaced by a rating of a new completion, and one history row per rating.

const satisfactionErrors = { translate: ["P2002", "P2034"] as const, fallbackMessage: "Satisfaction rating failed." };

async function findTarget(client: PrismaClient | Prisma.TransactionClient, requestId: string) {
  const request = await client.request.findUnique({
    where: { id: requestId },
    select: { requesterId: true, status: true, completedAt: true, satisfaction: { select: { completedAtSnapshot: true } } },
  });
  return (
    request && {
      requesterId: request.requesterId,
      status: request.status,
      completedAt: request.completedAt,
      ratedCompletionAt: request.satisfaction?.completedAtSnapshot ?? null,
    }
  );
}

function transactionOf(client: Prisma.TransactionClient): SatisfactionTransaction {
  return {
    async findActor(actorId) {
      return client.user.findUnique({ where: { id: actorId }, select: { id: true, role: true, isActive: true } });
    },
    findTarget(requestId) {
      return findTarget(client, requestId);
    },
    async currentTime() {
      const [{ now }] = await client.$queryRaw<Array<{ now: Date }>>`SELECT now() AS "now"`;
      return now;
    },
    async save(input) {
      const data = {
        requesterId: input.requesterId,
        rating: input.rating,
        comment: input.comment,
        completedAtSnapshot: input.completedAtSnapshot,
        ratedAt: input.ratedAt,
      };
      await client.requestSatisfaction.upsert({ where: { requestId: input.requestId }, create: { requestId: input.requestId, ...data }, update: data });
      await client.requestSatisfactionEvent.create({
        data: { requestId: input.requestId, actorId: input.requesterId, rating: input.rating, replaced: input.replaced, occurredAt: input.ratedAt },
      });
    },
  };
}

export function createPrismaSatisfactionStore(database: PrismaClient): SatisfactionStore {
  return {
    run(work) {
      return runSerializableTransaction(database, (client) => work(transactionOf(client)), satisfactionErrors);
    },
    async find(requestId) {
      return database.requestSatisfaction.findUnique({
        where: { requestId },
        select: { rating: true, comment: true, ratedAt: true, completedAtSnapshot: true },
      });
    },
    async history(requestId) {
      const rows = await database.requestSatisfactionEvent.findMany({
        where: { requestId },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        select: { rating: true, replaced: true, occurredAt: true, actor: { select: { name: true } } },
      });
      return rows.map((row) => ({ rating: row.rating, replaced: row.replaced, occurredAt: row.occurredAt, actorName: row.actor.name }));
    },
    findTarget(requestId) {
      return findTarget(database, requestId);
    },
  };
}
