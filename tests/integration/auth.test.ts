import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./fixtures";
import { authenticateCredentials } from "@/modules/auth/infrastructure/prisma-credentials";
import { hashPassword } from "@/modules/auth/infrastructure/argon2-password";
import { refreshSessionToken, sessionFromToken } from "@/modules/auth/infrastructure/next-auth-session";

describe("local authentication and session refresh", () => {
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await hashPassword("valid-password");
  });

  async function createUser(overrides: {
    email?: string;
    isActive?: boolean;
    role?: "ADMIN" | "REQUESTER" | "ATTENDANT";
    sectorId?: string | null;
  } = {}) {
    return prisma.user.create({
      data: {
        name: "Integration User",
        email: overrides.email ?? "person@example.test",
        role: overrides.role ?? "REQUESTER",
        sectorId: overrides.sectorId,
        passwordHash,
        isActive: overrides.isActive ?? true,
      },
    });
  }

  it("authenticates only active users and returns no client-controlled role or sector", async () => {
    const user = await createUser({ email: "person@example.test" });
    const authenticated = await authenticateCredentials({
      email: " PERSON@EXAMPLE.TEST ",
      password: "valid-password",
    }, prisma);

    expect(authenticated).toEqual({
      id: user.id,
      name: user.name,
      email: user.email,
    });
    expect(authenticated).not.toHaveProperty("role");
    expect(authenticated).not.toHaveProperty("sectorId");
  });

  it("rejects inactive users, wrong passwords, unknown emails, and extra credential fields", async () => {
    await createUser({ email: "inactive@example.test", isActive: false });
    await createUser({ email: "active@example.test" });

    await expect(
      authenticateCredentials({
        email: "inactive@example.test",
        password: "valid-password",
      }, prisma),
    ).resolves.toBeNull();
    await expect(
      authenticateCredentials({
        email: "active@example.test",
        password: "wrong-password",
      }, prisma),
    ).resolves.toBeNull();
    await expect(
      authenticateCredentials({
        email: "missing@example.test",
        password: "valid-password",
      }, prisma),
    ).resolves.toBeNull();
    await expect(
      authenticateCredentials({
        email: "active@example.test",
        password: "valid-password",
        role: "ADMIN",
        sectorId: "forged-sector",
      }, prisma),
    ).resolves.toBeNull();
  });

  it("refreshes role and sector from PostgreSQL and invalidates deactivated-user sessions", async () => {
    const user = await createUser();
    const initialToken = await refreshSessionToken({ sub: user.id }, undefined, prisma);

    expect(initialToken.role).toBe("REQUESTER");
    expect(initialToken.sectorId).toBeNull();
    expect(
      sessionFromToken({ expires: new Date(Date.now() + 60_000).toISOString(), user: null }, initialToken)
        .user,
    ).toMatchObject({ id: user.id, role: "REQUESTER", isActive: true });

    const sector = await prisma.sector.create({ data: { name: "Session sector" } });
    await prisma.user.update({
      where: { id: user.id },
      data: { role: "ATTENDANT", sectorId: sector.id },
    });

    const refreshedToken = await refreshSessionToken(initialToken, undefined, prisma);
    expect(refreshedToken.role).toBe("ATTENDANT");
    expect(refreshedToken.sectorId).toBe(sector.id);

    await prisma.user.update({
      where: { id: user.id },
      data: { isActive: false },
    });
    const invalidatedToken = await refreshSessionToken(refreshedToken, undefined, prisma);

    expect(invalidatedToken.sub).toBeUndefined();
    expect(invalidatedToken.role).toBeUndefined();
    expect(
      sessionFromToken(
        { expires: new Date(Date.now() + 60_000).toISOString(), user: null },
        invalidatedToken,
      ).user,
    ).toBeNull();
  });

  it("rejects malformed stored password hashes without authenticating", async () => {
    await prisma.user.create({
      data: {
        name: "Malformed Hash",
        email: "malformed@example.test",
        role: "REQUESTER",
        passwordHash: "not-a-password-hash",
      },
    });

    await expect(
      authenticateCredentials({
        email: "malformed@example.test",
        password: "valid-password",
      }, prisma),
    ).resolves.toBeNull();
  });
});
