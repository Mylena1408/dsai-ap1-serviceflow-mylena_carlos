import type { Prisma } from "@prisma/client";
import type { AuditScope } from "../application/ports";
import { planAuditEntry, type AuditEntityType } from "../domain/audit";

// Audit records written with the transaction client of the change (SPEC 2026-11-02-auditoria-lgpd,
// decision D5). The states are read from the database, so a use case cannot record what it did not do.

interface AuditState {
  label: string;
  state: object;
}

async function loadState(
  transaction: Prisma.TransactionClient,
  entityType: AuditEntityType,
  id: string,
): Promise<AuditState | null> {
  switch (entityType) {
    case "USER": {
      const row = await transaction.user.findUnique({
        where: { id },
        select: { name: true, email: true, role: true, sectorId: true, isActive: true },
      });
      return row && { label: row.name, state: row };
    }
    case "SECTOR": {
      const row = await transaction.sector.findUnique({ where: { id }, select: { name: true, isActive: true } });
      return row && { label: row.name, state: row };
    }
    case "CATEGORY": {
      const row = await transaction.category.findUnique({ where: { id }, select: { name: true, isActive: true } });
      return row && { label: row.name, state: row };
    }
    case "SERVICE": {
      const row = await transaction.service.findUnique({
        where: { id },
        select: {
          name: true,
          description: true,
          categoryId: true,
          sectorId: true,
          defaultPriority: true,
          slaHours: true,
          requiresApproval: true,
          isActive: true,
        },
      });
      return row && { label: row.name, state: row };
    }
    case "DOCUMENT_REQUIREMENT": {
      const row = await transaction.serviceDocumentRequirement.findUnique({
        where: { id },
        select: { name: true, isRequired: true, acceptedFormats: true, position: true, isActive: true },
      });
      return row && { label: row.name, state: row };
    }
    case "SERVICE_FIELD": {
      const row = await transaction.serviceField.findUnique({
        where: { id },
        select: {
          label: true,
          helpText: true,
          type: true,
          isRequired: true,
          options: true,
          minValue: true,
          maxValue: true,
          position: true,
          isActive: true,
        },
      });
      return row && { label: row.label, state: row };
    }
    case "SERVICE_STAGE": {
      const row = await transaction.serviceStage.findUnique({
        where: { id },
        select: { name: true, position: true, isActive: true },
      });
      return row && { label: row.name, state: row };
    }
    // SPEC 2026-11-02-api-externa-webhooks, 5.7: never the token hash or the webhook secret.
    case "API_TOKEN": {
      const row = await transaction.apiToken.findUnique({
        where: { id },
        select: { name: true, scope: true, expiresAt: true, revokedAt: true },
      });
      return row && { label: row.name, state: row };
    }
    case "WEBHOOK": {
      const row = await transaction.webhookEndpoint.findUnique({
        where: { id },
        select: { name: true, url: true, eventTypes: true, sectorIds: true, isActive: true },
      });
      return row && { label: row.name, state: row };
    }
  }
}

export function createPrismaAuditScope(transaction: Prisma.TransactionClient): AuditScope {
  return {
    async audited(meta, change) {
      const before = meta.entityId ? await loadState(transaction, meta.entityType, meta.entityId) : null;
      const result = await change();
      const after = await loadState(transaction, meta.entityType, result.id);

      if (after) {
        const entry = planAuditEntry({ ...meta, entityId: result.id, entityLabel: after.label }, before?.state ?? null, after.state);

        if (entry) {
          await transaction.auditEntry.create({
            data: { ...entry, changes: entry.changes as unknown as Prisma.InputJsonValue },
          });
        }
      }

      return result;
    },
  };
}
