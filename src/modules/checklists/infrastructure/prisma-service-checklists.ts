import type { Prisma, PrismaClient } from "@prisma/client";
import { createPrismaAuditScope } from "@/modules/audit";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import type { ServiceChecklistReader, ServiceChecklistStore, ServiceChecklistTransaction } from "../application/service-checklists";

// The services' checklist models in PostgreSQL (SPEC 2026-11-08-atendimento-dia-a-dia, 4.4): the CHECK bounds
// the text, the position and the condition; the composite key keeps the condition's field in the same service.

const columns = { id: true, text: true, isRequired: true, position: true, isActive: true, conditionFieldId: true, conditionValue: true } as const;
const order = [{ isActive: "desc" }, { position: "asc" }, { id: "asc" }] satisfies Prisma.ServiceChecklistItemOrderByWithRelationInput[];

export function createPrismaServiceChecklistReader(database: PrismaClient): ServiceChecklistReader {
  return {
    async list(sectorId) {
      const services = await database.service.findMany({
        where: { isActive: true, sector: { isActive: true }, ...(sectorId ? { sectorId } : {}) },
        orderBy: [{ sector: { name: "asc" } }, { name: "asc" }, { id: "asc" }],
        select: { id: true, name: true, sector: { select: { name: true } }, checklistItems: { orderBy: order, select: columns } },
      });
      return services.map((service) => ({
        service: { id: service.id, name: service.name, sectorName: service.sector.name },
        items: service.checklistItems,
      }));
    },
  };
}

function transactionOf(client: Prisma.TransactionClient): ServiceChecklistTransaction {
  return {
    ...createPrismaAuditScope(client),
    findService(serviceId) {
      return client.service.findUnique({ where: { id: serviceId }, select: { id: true, sectorId: true, isActive: true } });
    },
    findItem(itemId) {
      return client.serviceChecklistItem.findUnique({ where: { id: itemId }, select: { ...columns, serviceId: true } });
    },
    listItems(serviceId) {
      return client.serviceChecklistItem.findMany({ where: { serviceId }, orderBy: order, select: columns });
    },
    create(item) {
      return client.serviceChecklistItem.create({ data: item, select: columns });
    },
    update(itemId, data) {
      return client.serviceChecklistItem.update({ where: { id: itemId }, data, select: columns });
    },
  };
}

export function createPrismaServiceChecklistStore(database: PrismaClient): ServiceChecklistStore {
  return {
    run(work) {
      return runSerializableTransaction(database, (client) => work(transactionOf(client)), {
        translate: ["P2025", "P2034"],
        fallbackMessage: "Service checklist change failed.",
      });
    },
  };
}
