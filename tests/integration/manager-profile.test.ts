import { describe, expect, it, vi } from "vitest";
import { prisma } from "./fixtures";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { createDomainSector } from "./domain-fixtures";

// SPEC 2026-11-01-aprovacoes, section 5.1 (SF-082; CA-APR-02 users part and CA-APR-03).

vi.mock("@/server/authorization", () => ({
  requireConfigurationAdministrator: vi.fn().mockResolvedValue({
    id: "admin-from-server-session",
    role: "ADMIN",
    sectorId: null,
    isActive: true,
  }),
}));

import { createUser, setUserActive, updateUser } from "@/modules/users";
import { signInAsDemoUser } from "@/modules/auth/infrastructure/prisma-demo-accounts";
import { DEMO_ACCOUNTS, DEMO_SECTOR_NAME } from "@/modules/auth/domain/demo-accounts";

const manager = (email: string, sectorId: string | null) => ({
  name: "Gestora",
  email,
  password: "password",
  role: "MANAGER",
  sectorId,
});

describe("manager profile (SF-082)", () => {
  it("creates managers only with an active existing sector (CA-APR-02)", async () => {
    const sector = await createDomainSector();
    const inactive = await createDomainSector(false);

    await expect(createUser(manager("gestora@example.test", sector.id), prisma)).resolves.toMatchObject({
      role: "MANAGER",
      sectorId: sector.id,
    });
    await expect(createUser(manager("sem-setor@example.test", null), prisma)).rejects.toBeInstanceOf(ValidationError);
    await expect(createUser(manager("inativo@example.test", inactive.id), prisma)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(
      createUser(manager("inexistente@example.test", "00000000-0000-4000-8000-000000000010"), prisma),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("moves between profiles keeping the sector rule", async () => {
    const sector = await createDomainSector();
    const user = await createUser(
      { name: "Bia", email: "bia@example.test", password: "password", role: "REQUESTER", sectorId: null },
      prisma,
    );

    await expect(
      updateUser(user.id, { name: "Bia", email: "bia@example.test", role: "MANAGER", sectorId: null }, prisma),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      updateUser(user.id, { name: "Bia", email: "bia@example.test", role: "MANAGER", sectorId: sector.id }, prisma),
    ).resolves.toMatchObject({ role: "MANAGER", sectorId: sector.id });
    await expect(
      updateUser(user.id, { name: "Bia", email: "bia@example.test", role: "REQUESTER", sectorId: null }, prisma),
    ).resolves.toMatchObject({ role: "REQUESTER", sectorId: null });
  });

  it("does not reactivate a manager whose sector is inactive", async () => {
    const sector = await createDomainSector();
    const user = await createUser(manager("reativar@example.test", sector.id), prisma);
    await setUserActive(user.id, false, prisma);
    await prisma.sector.update({ where: { id: sector.id }, data: { isActive: false } });

    await expect(setUserActive(user.id, true, prisma)).rejects.toBeInstanceOf(ConflictError);
  });

  it("creates the demonstration manager in the demonstration sector, once (CA-APR-03)", async () => {
    const first = await signInAsDemoUser({ role: "MANAGER" }, prisma);
    const second = await signInAsDemoUser({ role: "MANAGER" }, prisma);

    expect(first).toEqual({ id: second?.id, ...DEMO_ACCOUNTS.MANAGER });
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: first?.id }, include: { sector: true } });
    expect(stored).toMatchObject({ role: "MANAGER", isActive: true });
    expect(stored.sector).toMatchObject({ name: DEMO_SECTOR_NAME, isActive: true });

    // The attendant shares the same demonstration sector.
    const attendant = await signInAsDemoUser({ role: "ATTENDANT" }, prisma);
    await expect(prisma.user.findUniqueOrThrow({ where: { id: attendant?.id } })).resolves.toMatchObject({
      sectorId: stored.sectorId,
    });
  });
});
