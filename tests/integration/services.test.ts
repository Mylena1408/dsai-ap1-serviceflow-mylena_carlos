import { vi, describe, expect, it } from "vitest";
import { prisma } from "./fixtures";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/server/errors";
import { updateCategory } from "@/modules/categories";
import { updateSector } from "@/modules/sectors";
import {
  createDomainCategory,
  createDomainRequest,
  createDomainSector,
  createDomainUser,
} from "./domain-fixtures";

vi.mock("@/server/authorization", () => ({
  // The catalog asks for a catalog editor since SPEC 2026-11-01-permissoes-configuraveis.
  requireCatalogEditor: vi.fn().mockResolvedValue({
    actor: { id: "admin-from-server-session", role: "ADMIN", sectorId: null, isActive: true },
    sectorId: null,
  }),
  assertCatalogSector: vi.fn(),
  requireConfigurationAdministrator: vi.fn().mockResolvedValue({
    id: "admin-from-server-session",
    role: "ADMIN",
    sectorId: null,
    isActive: true,
  }),
}));

import {
  assertServiceCanReceiveRequests,
  createService,
  listServices,
  setServiceActive,
  updateService,
} from "@/modules/services";

describe("service administration", () => {
  it("creates and lists a service only with existing active relationships", async () => {
    const category = await createDomainCategory();
    const sector = await createDomainSector();
    const created = await createService(
      {
        name: "  Equipment support ",
        description: " Help with office equipment ",
        categoryId: category.id,
        sectorId: sector.id,
      },
      prisma,
    );

    expect(created).toMatchObject({
      name: "Equipment support",
      description: "Help with office equipment",
      categoryId: category.id,
      sectorId: sector.id,
      isActive: true,
    });
    await expect(listServices(prisma)).resolves.toContainEqual(
      expect.objectContaining({ id: created.id }),
    );
  });

  it("validates required names and descriptions and rejects missing/inactive relationships", async () => {
    const category = await createDomainCategory();
    const sector = await createDomainSector();
    const inactiveCategory = await createDomainCategory(false);
    const inactiveSector = await createDomainSector(false);
    const input = {
      name: "Service",
      description: "Description",
      categoryId: category.id,
      sectorId: sector.id,
    };

    await expect(
      createService({ ...input, name: " " }, prisma),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createService({ ...input, description: " " }, prisma),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createService(
        { ...input, categoryId: "00000000-0000-4000-8000-000000000011" },
        prisma,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createService({ ...input, categoryId: inactiveCategory.id }, prisma),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      createService({ ...input, sectorId: inactiveSector.id }, prisma),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("requires active relationships when reactivating a service", async () => {
    const category = await createDomainCategory();
    const sector = await createDomainSector();
    const service = await createService(
      {
        name: "Lifecycle service",
        description: "Service used to verify activation constraints",
        categoryId: category.id,
        sectorId: sector.id,
      },
      prisma,
    );
    await setServiceActive(service.id, false, prisma);
    await prisma.category.update({
      where: { id: category.id },
      data: { isActive: false },
    });

    await expect(
      setServiceActive(service.id, true, prisma),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      prisma.service.findUniqueOrThrow({ where: { id: service.id } }),
    ).resolves.toMatchObject({ isActive: false });
  });

  it("edits current configuration without changing request snapshots", async () => {
    const category = await createDomainCategory();
    const sector = await createDomainSector();
    const nextCategory = await createDomainCategory();
    const nextSector = await createDomainSector();
    const requester = await createDomainUser({ role: "REQUESTER" });
    const service = await createService(
      {
        name: "Original service",
        description: "Original service description",
        categoryId: category.id,
        sectorId: sector.id,
      },
      prisma,
    );
    const request = await createDomainRequest({
      requesterId: requester.id,
      serviceId: service.id,
      sectorId: sector.id,
    });

    await updateService(
      service.id,
      {
        name: "Renamed service",
        description: "Updated service description",
        categoryId: nextCategory.id,
        sectorId: nextSector.id,
      },
      prisma,
    );
    await updateCategory(
      category.id,
      { name: "Renamed historical category" },
      prisma,
    );
    await updateSector(
      sector.id,
      { name: "Renamed historical sector" },
      prisma,
    );

    await expect(
      prisma.request.findUniqueOrThrow({ where: { id: request.id } }),
    ).resolves.toMatchObject({
      serviceId: service.id,
      serviceNameSnapshot: "Original service",
      serviceDescriptionSnapshot: "Original service description",
      categoryIdSnapshot: category.id,
      categoryNameSnapshot: category.name,
      sectorId: sector.id,
      sectorNameSnapshot: sector.name,
    });
  });

  it("deactivates a referenced service without deleting or changing existing requests", async () => {
    const category = await createDomainCategory();
    const sector = await createDomainSector();
    const requester = await createDomainUser({ role: "REQUESTER" });
    const service = await createService(
      {
        name: "Retained service",
        description: "Existing requests retain this service reference",
        categoryId: category.id,
        sectorId: sector.id,
      },
      prisma,
    );
    const request = await createDomainRequest({
      requesterId: requester.id,
      serviceId: service.id,
      sectorId: sector.id,
    });

    await expect(
      setServiceActive(service.id, false, prisma),
    ).resolves.toMatchObject({ isActive: false });
    expect(() =>
      assertServiceCanReceiveRequests({
        isActive: false,
        categoryActive: true,
        sectorActive: true,
      }),
    ).toThrow(NotFoundError);
    await expect(
      prisma.request.findUniqueOrThrow({ where: { id: request.id } }),
    ).resolves.toMatchObject({
      serviceId: service.id,
      serviceNameSnapshot: "Retained service",
      status: "OPEN",
    });
    await expect(
      prisma.service.count({ where: { id: service.id } }),
    ).resolves.toBe(1);
  });
});
