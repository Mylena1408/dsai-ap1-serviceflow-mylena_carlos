import { describe, expect, it } from "vitest";
import { prisma } from "./fixtures";
import { signInAsDemoUser } from "@/modules/auth/infrastructure/prisma-demo-accounts";
import { authenticateCredentials } from "@/modules/auth/infrastructure/prisma-credentials";
import { DEMO_ACCOUNTS, DEMO_SECTOR_NAME } from "@/modules/auth/domain/demo-accounts";

// SPEC 2026-09-30, section 22: demonstration sign-in without e-mail or password.
describe("demonstration accounts", () => {
  it("creates one account per role and reuses it on later sign-ins (CA-DEMO-02)", async () => {
    const first = await signInAsDemoUser({ role: "ADMIN" }, prisma);
    const second = await signInAsDemoUser({ role: "ADMIN" }, prisma);

    expect(first).toEqual({ id: second?.id, ...DEMO_ACCOUNTS.ADMIN });
    await expect(
      prisma.user.count({ where: { email: DEMO_ACCOUNTS.ADMIN.email } }),
    ).resolves.toBe(1);
    await expect(
      prisma.user.findUniqueOrThrow({ where: { email: DEMO_ACCOUNTS.ADMIN.email } }),
    ).resolves.toMatchObject({ role: "ADMIN", sectorId: null, isActive: true });
  });

  it("links the attendant to an active demonstration sector (CA-DEMO-03)", async () => {
    const attendant = await signInAsDemoUser({ role: "ATTENDANT" }, prisma);
    await signInAsDemoUser({ role: "ATTENDANT" }, prisma);

    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: attendant?.id },
      include: { sector: true },
    });
    expect(stored).toMatchObject({ role: "ATTENDANT", isActive: true });
    expect(stored.sector).toMatchObject({ name: DEMO_SECTOR_NAME, isActive: true });
    await expect(prisma.sector.count({ where: { name: DEMO_SECTOR_NAME } })).resolves.toBe(1);
  });

  it("restores a demonstration account changed or deactivated in administration", async () => {
    const requester = await signInAsDemoUser({ role: "REQUESTER" }, prisma);
    await prisma.user.update({
      where: { id: requester?.id },
      data: { isActive: false, name: "Renamed" },
    });

    await signInAsDemoUser({ role: "REQUESTER" }, prisma);

    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: requester?.id } }),
    ).resolves.toMatchObject({
      name: DEMO_ACCOUNTS.REQUESTER.name,
      role: "REQUESTER",
      isActive: true,
    });
  });

  it("refuses invalid roles without creating users (CA-DEMO-04)", async () => {
    for (const input of [{ role: "ROOT" }, { role: "admin" }, {}, { role: "ADMIN", extra: true }]) {
      await expect(signInAsDemoUser(input, prisma)).resolves.toBeNull();
    }
    await expect(prisma.user.count()).resolves.toBe(0);
  });

  it("cannot be used through the e-mail and password form (CA-DEMO-05)", async () => {
    await signInAsDemoUser({ role: "ADMIN" }, prisma);

    for (const password of ["", "demo", DEMO_ACCOUNTS.ADMIN.email]) {
      await expect(
        authenticateCredentials({ email: DEMO_ACCOUNTS.ADMIN.email, password }, prisma),
      ).resolves.toBeNull();
    }
  });
});
