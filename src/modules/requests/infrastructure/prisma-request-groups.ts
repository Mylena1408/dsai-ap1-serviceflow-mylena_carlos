import type { Prisma, PrismaClient } from "@prisma/client";
import type { GroupReader, GroupRecord } from "../application/groups";

// The groups of the bundle openings (SPEC 2026-11-07-operacao-e-automacao, 3.4).

const groupColumns = {
  id: true,
  bundleNameSnapshot: true,
  requesterId: true,
  createdAt: true,
  requests: {
    // The requests share the opening instant: the position keeps the bundle's order.
    orderBy: { groupPosition: "asc" },
    select: {
      id: true,
      requesterId: true,
      sectorId: true,
      serviceNameSnapshot: true,
      status: true,
      approvalState: true,
      approvalSectorIdsSnapshot: true,
      sector: { select: { name: true } },
    },
  },
} satisfies Prisma.RequestGroupSelect;

type GroupRow = Prisma.RequestGroupGetPayload<{ select: typeof groupColumns }>;

const toRecord = (row: GroupRow): GroupRecord => ({
  id: row.id,
  bundleName: row.bundleNameSnapshot,
  requesterId: row.requesterId,
  createdAt: row.createdAt,
  requests: row.requests.map((request) => ({
    id: request.id,
    requesterId: request.requesterId,
    sectorId: request.sectorId,
    serviceName: request.serviceNameSnapshot,
    sectorName: request.sector.name,
    status: request.status,
    approvalState: request.approvalState,
    approvalSectorIds: request.approvalSectorIdsSnapshot,
  })),
});

export function createPrismaGroupReader(database: PrismaClient): GroupReader {
  return {
    async findGroup(groupId) {
      const row = await database.requestGroup.findUnique({ where: { id: groupId }, select: groupColumns });
      return row && toRecord(row);
    },
    async findGroupOfRequest(requestId) {
      const request = await database.request.findUnique({ where: { id: requestId }, select: { group: { select: groupColumns } } });
      return request?.group ? toRecord(request.group) : null;
    },
    async groupsOfRequests(requestIds) {
      const rows = await database.request.findMany({
        where: { id: { in: [...requestIds] }, groupId: { not: null } },
        select: { id: true, group: { select: { id: true, bundleNameSnapshot: true } } },
      });
      return rows.flatMap(({ id, group }) => (group ? [{ requestId: id, groupId: group.id, bundleName: group.bundleNameSnapshot }] : []));
    },
  };
}
