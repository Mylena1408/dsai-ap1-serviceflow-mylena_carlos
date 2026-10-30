import { vi, describe, expect, it } from "vitest";
import { prisma } from "./fixtures";
import { NotFoundError } from "@/server/errors";
import {
  createDomainCategory,
  createDomainSector,
  createDomainService,
} from "./domain-fixtures";

vi.mock("@/server/authorization", () => ({
  requirePublishedCatalogReader: vi.fn().mockResolvedValue({
    id: "requester-from-session",
    role: "REQUESTER",
    sectorId: null,
    isActive: true,
  }),
}));

import {
  getPublishedService,
  listPublishedServices,
} from "@/modules/services";

describe("published service catalog", () => {
  it("returns only services with active service, category, and sector and includes current details", async () => {
    const activeCategory = await createDomainCategory();
    const inactiveCategory = await createDomainCategory(false);
    const activeSector = await createDomainSector();
    const inactiveSector = await createDomainSector(false);
    const listed = await createDomainService({
      categoryId: activeCategory.id,
      sectorId: activeSector.id,
    });
    const serviceWithInactiveCategory = await createDomainService({
      categoryId: inactiveCategory.id,
      sectorId: activeSector.id,
    });
    const serviceWithInactiveSector = await createDomainService({
      categoryId: activeCategory.id,
      sectorId: inactiveSector.id,
    });
    const individuallyInactive = await createDomainService({
      categoryId: activeCategory.id,
      sectorId: activeSector.id,
      isActive: false,
    });

    const results = await listPublishedServices(prisma);

    expect(results.map(({ id }) => id)).toEqual([listed.id]);
    expect(results[0]).toMatchObject({
      name: listed.name,
      description: listed.description,
      category: { id: activeCategory.id, name: activeCategory.name },
      sector: { id: activeSector.id, name: activeSector.name },
    });
    expect(results.map(({ id }) => id)).not.toContain(serviceWithInactiveCategory.id);
    expect(results.map(({ id }) => id)).not.toContain(serviceWithInactiveSector.id);
    expect(results.map(({ id }) => id)).not.toContain(individuallyInactive.id);
  });

  it("returns details only for currently published services", async () => {
    const category = await createDomainCategory();
    const sector = await createDomainSector();
    const published = await createDomainService({
      categoryId: category.id,
      sectorId: sector.id,
    });
    const unavailableCategory = await createDomainCategory(false);
    const unavailable = await createDomainService({
      categoryId: unavailableCategory.id,
      sectorId: sector.id,
    });

    await expect(getPublishedService(published.id, prisma)).resolves.toMatchObject({
      id: published.id,
      name: published.name,
      description: published.description,
    });
    await expect(
      getPublishedService(unavailable.id, prisma),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      getPublishedService("00000000-0000-4000-8000-000000000015", prisma),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
