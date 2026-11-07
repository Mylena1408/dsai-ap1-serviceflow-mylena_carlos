import { z } from "zod";
import { requireCatalogEditor, requireConfigurationAdministrator } from "@/server/authorization";
import { NotFoundError } from "@/server/errors";
import { activeStateAction } from "@/modules/audit";
import { validateInput } from "@/server/validation";
import { activeStateSchema, entityIdSchema } from "@/shared/validation";
import { sectorInputSchema } from "./sector-schemas";
import { assertSectorCanBeDeactivated } from "../domain/deactivation";
import type { SectorRecord } from "../domain/sector";
import type { SectorRepository, SectorTransactionRunner } from "./ports";

export async function listSectors(repository: SectorRepository): Promise<SectorRecord[]> {
  await requireConfigurationAdministrator();

  return repository.listByName();
}

// Sector choices of a catalog editor: every sector for the administrator, only the own one for a
// holder of "Gerir serviços do setor" (SPEC de permissões, 5.3.1).
export async function listSectorsForCatalog(repository: SectorRepository): Promise<SectorRecord[]> {
  const editor = await requireCatalogEditor();
  const sectors = await repository.listByName();

  return editor.sectorId === null ? sectors : sectors.filter((sector) => sector.id === editor.sectorId);
}

/**
 * Active sectors, by name, as choices for the approval levels of a service (SPEC
 * 2026-11-06-aprofundamento-configurabilidade, 4.3.1, decision G19): whoever configures a service may
 * pick any active sector as a level, because a level only says who approves. Only id and name.
 */
export async function listApprovalSectorChoices(repository: SectorRepository): Promise<Array<{ id: string; name: string }>> {
  await requireCatalogEditor();
  const sectors = await repository.listByName();
  return sectors.filter((sector) => sector.isActive).map(({ id, name }) => ({ id, name }));
}

export async function createSector(
  input: unknown,
  transactions: SectorTransactionRunner,
): Promise<SectorRecord> {
  const actor = await requireConfigurationAdministrator();
  const { name } = validateInput(sectorInputSchema, input);

  return transactions.run((transaction) =>
    transaction.audited({ actor, action: "CREATED", entityType: "SECTOR" }, () => transaction.create(name)),
  );
}

export async function updateSector(
  id: unknown,
  input: unknown,
  transactions: SectorTransactionRunner,
): Promise<SectorRecord> {
  const actor = await requireConfigurationAdministrator();
  const sectorId = validateInput(entityIdSchema, id);
  const { name } = validateInput(sectorInputSchema, input);

  return transactions.run(async (transaction) => {
    if (!(await transaction.exists(sectorId))) {
      throw new NotFoundError();
    }

    return transaction.audited({ actor, action: "UPDATED", entityType: "SECTOR", entityId: sectorId }, () =>
      transaction.update(sectorId, { name }),
    );
  });
}

/** SPEC 2026-11-06-escalonamento, 2.1 and 4.6: only the administrator; audited as a sector change. */
export async function setSectorEscalation(
  id: unknown,
  enabled: unknown,
  transactions: SectorTransactionRunner,
): Promise<SectorRecord> {
  const actor = await requireConfigurationAdministrator();
  const sectorId = validateInput(entityIdSchema, id);
  const escalateOverdue = validateInput(z.boolean(), enabled);

  return transactions.run(async (transaction) => {
    if (!(await transaction.exists(sectorId))) {
      throw new NotFoundError();
    }

    return transaction.audited({ actor, action: "UPDATED", entityType: "SECTOR", entityId: sectorId }, () =>
      transaction.update(sectorId, { escalateOverdue }),
    );
  });
}

export async function setSectorActive(
  id: unknown,
  isActive: unknown,
  transactions: SectorTransactionRunner,
): Promise<SectorRecord> {
  const actor = await requireConfigurationAdministrator();
  const sectorId = validateInput(entityIdSchema, id);
  const active = validateInput(activeStateSchema, isActive);

  return transactions.run(async (transaction) => {
    if (!(await transaction.exists(sectorId))) {
      throw new NotFoundError();
    }

    if (!active) {
      assertSectorCanBeDeactivated(
        await transaction.findDeactivationDependencies(sectorId),
      );
    }

    return transaction.audited({ actor, action: activeStateAction(active), entityType: "SECTOR", entityId: sectorId }, () =>
      transaction.update(sectorId, { isActive: active }),
    );
  });
}
