import { requireConfigurationAdministrator } from "@/server/authorization";
import { NotFoundError } from "@/server/errors";
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

export async function createSector(
  input: unknown,
  transactions: SectorTransactionRunner,
): Promise<SectorRecord> {
  await requireConfigurationAdministrator();
  const { name } = validateInput(sectorInputSchema, input);

  return transactions.run((transaction) => transaction.create(name));
}

export async function updateSector(
  id: unknown,
  input: unknown,
  transactions: SectorTransactionRunner,
): Promise<SectorRecord> {
  await requireConfigurationAdministrator();
  const sectorId = validateInput(entityIdSchema, id);
  const { name } = validateInput(sectorInputSchema, input);

  return transactions.run(async (transaction) => {
    if (!(await transaction.exists(sectorId))) {
      throw new NotFoundError();
    }

    return transaction.update(sectorId, { name });
  });
}

export async function setSectorActive(
  id: unknown,
  isActive: unknown,
  transactions: SectorTransactionRunner,
): Promise<SectorRecord> {
  await requireConfigurationAdministrator();
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

    return transaction.update(sectorId, { isActive: active });
  });
}
