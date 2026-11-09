import type { Prisma, PrismaClient } from "@prisma/client";
import { loadEffectivePermissions } from "@/server/authorization/effective-permissions";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import { hasPermissionInSector } from "@/shared/permissions";
import type { ChecklistActor, ChecklistRequestStatus } from "../domain/checklist";
import type {
  ChecklistRequest,
  RequestChecklistReader,
  RequestChecklistStore,
  RequestChecklistTransaction,
} from "../application/request-checklist";

// A request's checklist in PostgreSQL (SPEC 2026-11-08-atendimento-dia-a-dia, 4.4): the marking is written only
// when the item is still as read, and its CHECK keeps who, when and the note together.

type Client = PrismaClient | Prisma.TransactionClient;

const itemColumns = { id: true, textSnapshot: true, isRequired: true, position: true, doneAt: true, doneById: true, note: true } as const;

async function findRequest(client: Client, requestId: string): Promise<ChecklistRequest | null> {
  const row = await client.request.findUnique({
    where: { id: requestId },
    select: { sectorId: true, status: true, assignee: { select: { id: true, role: true, isActive: true, sectorId: true } } },
  });
  if (!row) return null;
  const holder = row.assignee;
  return {
    sectorId: row.sectorId,
    status: row.status as ChecklistRequestStatus,
    // The same rule as the other attendance actions: an assignee who left the sector holds nothing.
    effectiveAssigneeId: holder && holder.isActive && holder.role === "ATTENDANT" && holder.sectorId === row.sectorId ? holder.id : null,
  };
}

async function supervises(client: Client, actor: ChecklistActor, sectorId: string): Promise<boolean> {
  return hasPermissionInSector(actor, await loadEffectivePermissions(client, actor.id), "QUEUE_SUPERVISION", sectorId);
}

export function createPrismaRequestChecklistReader(database: PrismaClient): RequestChecklistReader {
  return {
    findRequest: (requestId) => findRequest(database, requestId),
    supervises: (actor, sectorId) => supervises(database, actor, sectorId),
    async items(requestId) {
      const [copied, rows] = await Promise.all([
        database.requestChecklist.count({ where: { requestId } }),
        database.requestChecklistItem.findMany({
          where: { requestId },
          orderBy: { position: "asc" },
          select: { ...itemColumns, doneBy: { select: { name: true } } },
        }),
      ]);
      if (copied === 0) return null;
      return rows.map(({ doneBy, ...item }) => ({ ...item, doneByName: doneBy?.name ?? null }));
    },
    async events(requestId) {
      const rows = await database.requestChecklistEvent.findMany({
        where: { requestId },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        select: { id: true, occurredAt: true, action: true, note: true, item: { select: { textSnapshot: true } }, actor: { select: { name: true } } },
      });
      return rows.map((row) => ({
        id: row.id,
        occurredAt: row.occurredAt,
        action: row.action,
        itemText: row.item.textSnapshot,
        note: row.note,
        actorName: row.actor.name,
      }));
    },
  };
}

function transactionOf(client: Prisma.TransactionClient): RequestChecklistTransaction {
  return {
    findActor(userId) {
      return client.user.findUnique({ where: { id: userId }, select: { id: true, role: true, isActive: true, sectorId: true } });
    },
    findRequest: (requestId) => findRequest(client, requestId),
    supervises: (actor, sectorId) => supervises(client, actor, sectorId),
    findItem(itemId) {
      return client.requestChecklistItem.findUnique({ where: { id: itemId }, select: { ...itemColumns, requestId: true } });
    },
    async currentTime() {
      const [row] = await client.$queryRaw<Array<{ now: Date }>>`SELECT now() AS "now"`;
      return row.now;
    },
    async mark({ itemId, expectedDoneAt, ...data }) {
      const result = await client.requestChecklistItem.updateMany({ where: { id: itemId, doneAt: expectedDoneAt }, data });
      return result.count === 1;
    },
    async insertEvent(event) {
      await client.requestChecklistEvent.create({ data: event });
    },
  };
}

export function createPrismaRequestChecklistStore(database: PrismaClient): RequestChecklistStore {
  return {
    run(work) {
      return runSerializableTransaction(database, (client) => work(transactionOf(client)), {
        translate: ["P2025", "P2034"],
        fallbackMessage: "Request checklist change failed.",
      });
    },
  };
}

/** 13.1 item 3: marked over total for each request of the sector that has items, in one grouped read. */
export function createPrismaChecklistProgressReader(database: PrismaClient) {
  return {
    async progressOf(requestIds: readonly string[], sectorId: string) {
      const rows = await database.requestChecklistItem.groupBy({
        by: ["requestId"],
        where: { requestId: { in: [...requestIds] }, request: { sectorId } },
        _count: { _all: true, doneAt: true },
      });
      return new Map(rows.map((row) => [row.requestId, { done: row._count.doneAt, total: row._count._all }]));
    },
  };
}
