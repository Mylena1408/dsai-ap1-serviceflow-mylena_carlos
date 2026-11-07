import type { Prisma, PrismaClient } from "@prisma/client";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import type { LinkReader, LinkRequestState, LinkStore, LinkTransaction } from "../application/links";
import type { LinkRecord } from "../domain/links";

// Links between requests in PostgreSQL (SPEC 2026-11-07-operacao-e-automacao, 3.4). The pair and the
// "one original per duplicate" rules are also unique indexes; the rest runs in a serializable
// transaction.

type Client = PrismaClient | Prisma.TransactionClient;

const stateColumns = {
  id: true,
  requesterId: true,
  sectorId: true,
  approvalState: true,
  approvalSectorIdsSnapshot: true,
  status: true,
  serviceNameSnapshot: true,
  sector: { select: { name: true } },
} as const;

type StateRow = Prisma.RequestGetPayload<{ select: typeof stateColumns }>;

const toState = (row: StateRow): LinkRequestState => ({
  id: row.id,
  requesterId: row.requesterId,
  sectorId: row.sectorId,
  // The read rule of the attachments: managers read a request that requires approval.
  requiresApproval: row.approvalState !== null,
  approvalSectorIds: row.approvalSectorIdsSnapshot,
  status: row.status,
  serviceName: row.serviceNameSnapshot,
  // The sector's current name, as the queue shows it.
  sectorName: row.sector.name,
});

const linkColumns = { id: true, fromRequestId: true, toRequestId: true, kind: true } as const;

function linksOf(client: Client, requestId: string): Promise<LinkRecord[]> {
  return client.requestLink.findMany({
    where: { OR: [{ fromRequestId: requestId }, { toRequestId: requestId }] },
    select: linkColumns,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

function transactionOf(client: Prisma.TransactionClient): LinkTransaction {
  return {
    async currentTime() {
      const [row] = await client.$queryRaw<Array<{ now: Date }>>`SELECT now() AS "now"`;
      return row.now;
    },
    async findRequest(requestId) {
      const row = await client.request.findUnique({ where: { id: requestId }, select: stateColumns });
      return row && toState(row);
    },
    async findByCode({ from, to }) {
      const rows = await client.request.findMany({ where: { id: { gte: from, lte: to } }, select: { id: true }, take: 2 });
      return rows.map(({ id }) => id);
    },
    linksOf: (requestId) => linksOf(client, requestId),
    insertLink(link) {
      return client.requestLink.create({ data: link, select: { id: true } });
    },
    async deleteLink(linkId) {
      await client.requestLink.delete({ where: { id: linkId } });
    },
    async insertEvent(event) {
      await client.requestLinkEvent.create({ data: event });
    },
  };
}

export function createPrismaLinkStore(database: PrismaClient): LinkStore {
  return {
    run(work) {
      return runSerializableTransaction(database, (transaction) => work(transactionOf(transaction)), {
        // Two links of the same pair at once: the unique index refuses the second.
        translate: ["P2002", "P2025", "P2003", "P2034"],
        fallbackMessage: "Request link operation failed.",
      });
    },
  };
}

export function createPrismaLinkReader(database: PrismaClient): LinkReader {
  return {
    async listLinks(requestId) {
      const rows = await database.requestLink.findMany({
        where: { OR: [{ fromRequestId: requestId }, { toRequestId: requestId }] },
        select: { ...linkColumns, fromRequest: { select: stateColumns }, toRequest: { select: stateColumns } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      return rows.map(({ fromRequest, toRequest, ...link }) => ({
        ...link,
        other: toState(link.fromRequestId === requestId ? toRequest : fromRequest),
      }));
    },
    async listEvents(requestId) {
      const rows = await database.requestLinkEvent.findMany({
        where: { OR: [{ fromRequestId: requestId }, { toRequestId: requestId }] },
        select: {
          id: true,
          fromRequestId: true,
          toRequestId: true,
          kind: true,
          action: true,
          occurredAt: true,
          actor: { select: { id: true, name: true } },
          fromRequest: { select: { requesterId: true } },
          toRequest: { select: { requesterId: true } },
        },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      });
      return rows.map(({ fromRequest, toRequest, ...event }) => ({
        ...event,
        otherRequesterId: event.fromRequestId === requestId ? toRequest.requesterId : fromRequest.requesterId,
      }));
    },
  };
}
