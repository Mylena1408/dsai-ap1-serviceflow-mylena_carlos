import { vi, describe, expect, it } from "vitest";
import { prisma } from "./fixtures";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/server/errors";
import { verifyPassword } from "@/modules/auth";
import {
  createDomainCategory,
  createDomainRequest,
  createDomainSector,
  createDomainService,
  createDomainUser,
} from "./domain-fixtures";

vi.mock("@/server/authorization", () => ({
  requireConfigurationAdministrator: vi.fn().mockResolvedValue({
    id: "admin-from-server-session",
    role: "ADMIN",
    sectorId: null,
    isActive: true,
  }),
}));

import {
  createUser,
  listUsers,
  setUserActive,
  updateUser,
} from "@/modules/users";

describe("user administration", () => {
  it("creates and lists users with normalized email and Argon2id hashes only", async () => {
    const user = await createUser(
      {
        name: "  New Requester ",
        email: " USER@EXAMPLE.TEST ",
        password: "user-password",
        role: "REQUESTER",
      },
      prisma,
    );
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });

    expect(user).toMatchObject({
      name: "New Requester",
      email: "user@example.test",
      role: "REQUESTER",
      sectorId: null,
      isActive: true,
    });
    expect(user).not.toHaveProperty("passwordHash");
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    await expect(
      verifyPassword(stored.passwordHash, "user-password"),
    ).resolves.toBe(true);
    await expect(listUsers(prisma)).resolves.toContainEqual(
      expect.objectContaining({ id: user.id, email: user.email }),
    );
  });

  it("requires an active existing sector for attendants and rejects invalid profile/sector pairs", async () => {
    const activeSector = await createDomainSector();
    const inactiveSector = await createDomainSector(false);

    await expect(
      createUser(
        {
          name: "Attendant",
          email: "attendant@example.test",
          password: "password",
          role: "ATTENDANT",
          sectorId: activeSector.id,
        },
        prisma,
      ),
    ).resolves.toMatchObject({ role: "ATTENDANT", sectorId: activeSector.id });
    await expect(
      createUser(
        {
          name: "Inactive Sector Attendant",
          email: "inactive-sector@example.test",
          password: "password",
          role: "ATTENDANT",
          sectorId: inactiveSector.id,
        },
        prisma,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      createUser(
        {
          name: "Missing Sector Attendant",
          email: "missing-sector@example.test",
          password: "password",
          role: "ATTENDANT",
          sectorId: "00000000-0000-4000-8000-000000000010",
        },
        prisma,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createUser(
        {
          name: "Invalid Requester",
          email: "invalid-requester@example.test",
          password: "password",
          role: "REQUESTER",
          sectorId: activeSector.id,
        },
        prisma,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("normalizes and enforces globally unique email addresses", async () => {
    await createUser(
      {
        name: "First",
        email: "person@example.test",
        password: "password",
        role: "REQUESTER",
      },
      prisma,
    );

    await expect(
      createUser(
        {
          name: "Duplicate",
          email: " PERSON@EXAMPLE.TEST ",
          password: "password",
          role: "REQUESTER",
        },
        prisma,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("hashes an updated password and requires active sectors for attendant updates", async () => {
    const sector = await createDomainSector();
    const inactiveSector = await createDomainSector(false);
    const user = await createUser(
      {
        name: "Updatable Attendant",
        email: "updatable-attendant@example.test",
        password: "original-password",
        role: "ATTENDANT",
        sectorId: sector.id,
      },
      prisma,
    );

    await expect(
      updateUser(
        user.id,
        {
          name: user.name,
          email: user.email,
          password: "replacement-password",
          role: "ATTENDANT",
          sectorId: sector.id,
        },
        prisma,
      ),
    ).resolves.not.toHaveProperty("passwordHash");
    const updated = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true, sectorId: true },
    });
    await expect(
      verifyPassword(updated.passwordHash, "replacement-password"),
    ).resolves.toBe(true);
    await expect(
      verifyPassword(updated.passwordHash, "original-password"),
    ).resolves.toBe(false);

    await expect(
      updateUser(
        user.id,
        {
          name: user.name,
          email: user.email,
          role: "ATTENDANT",
          sectorId: inactiveSector.id,
        },
        prisma,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).resolves.toMatchObject({ sectorId: sector.id });
  });

  it("prevents deactivation or reclassification of the last active administrator", async () => {
    const admin = await createDomainUser({
      role: "ADMIN",
      email: "sole-admin@example.test",
    });
    const update = {
      name: admin.name,
      email: admin.email,
      role: "REQUESTER" as const,
    };

    await expect(setUserActive(admin.id, false, prisma)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(updateUser(admin.id, update, prisma)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: admin.id } }),
    ).resolves.toMatchObject({ role: "ADMIN", isActive: true });

    await createDomainUser({ role: "ADMIN", email: "second-admin@example.test" });
    await expect(updateUser(admin.id, update, prisma)).resolves.toMatchObject({
      role: "REQUESTER",
      isActive: true,
    });
  });

  it("blocks removing the last attendant from a sector with pending requests", async () => {
    const sector = await createDomainSector();
    const attendant = await createDomainUser({
      role: "ATTENDANT",
      sectorId: sector.id,
      email: "last-attendant@example.test",
    });
    const owner = await createDomainUser({
      role: "REQUESTER",
      email: "attendant-request-owner@example.test",
    });
    const category = await createDomainCategory();
    const serviceSector = await createDomainSector();
    const service = await createDomainService({
      categoryId: category.id,
      sectorId: serviceSector.id,
    });
    await createDomainRequest({
      requesterId: owner.id,
      serviceId: service.id,
      sectorId: sector.id,
      status: "IN_PROGRESS",
    });
    const update = {
      name: attendant.name,
      email: attendant.email,
      role: "REQUESTER" as const,
    };

    await expect(setUserActive(attendant.id, false, prisma)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(updateUser(attendant.id, update, prisma)).rejects.toBeInstanceOf(
      ConflictError,
    );

    await createDomainUser({
      role: "ATTENDANT",
      sectorId: sector.id,
      email: "backup-attendant@example.test",
    });
    await expect(updateUser(attendant.id, update, prisma)).resolves.toMatchObject({
      role: "REQUESTER",
      sectorId: null,
    });
  });

  it("preserves historical request references when a user becomes inactive", async () => {
    const requester = await createDomainUser({
      role: "REQUESTER",
      email: "historical-requester@example.test",
    });
    const sector = await createDomainSector();
    const category = await createDomainCategory();
    const service = await createDomainService({
      categoryId: category.id,
      sectorId: sector.id,
    });
    const request = await createDomainRequest({
      requesterId: requester.id,
      serviceId: service.id,
      sectorId: sector.id,
    });

    await setUserActive(requester.id, false, prisma);

    await expect(
      prisma.request.findUniqueOrThrow({ where: { id: request.id } }),
    ).resolves.toMatchObject({ requesterId: requester.id });
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: requester.id } }),
    ).resolves.toMatchObject({ isActive: false });
  });
});
