import { describe, expect, it } from "vitest";
import { prisma } from "./fixtures";
import { bootstrapFirstAdmin } from "@/modules/auth/infrastructure/prisma-bootstrap-admin";
import { verifyPassword } from "@/modules/auth/infrastructure/argon2-password";
import { ConflictError, ValidationError } from "@/server/errors";

describe("secure first administrator bootstrap", () => {
  it("creates an active administrator with only an Argon2id hash stored", async () => {
    const input = {
      name: "Initial Administrator",
      email: " ADMIN@EXAMPLE.TEST ",
      password: "initial-secret",
    };
    const created = await bootstrapFirstAdmin(input, prisma);
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: created.id },
    });

    expect(created).toEqual({
      id: stored.id,
      name: "Initial Administrator",
      email: "admin@example.test",
    });
    expect(created).not.toHaveProperty("passwordHash");
    expect(stored).toMatchObject({
      role: "ADMIN",
      sectorId: null,
      isActive: true,
    });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(stored.passwordHash, input.password)).resolves.toBe(true);
  });

  it("refuses a second bootstrap and does not create another administrator", async () => {
    await bootstrapFirstAdmin(
      {
        name: "Initial Administrator",
        email: "initial@example.test",
        password: "initial-secret",
      },
      prisma,
    );

    await expect(
      bootstrapFirstAdmin(
        {
          name: "Second Administrator",
          email: "second@example.test",
          password: "second-secret",
        },
        prisma,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(prisma.user.count({ where: { role: "ADMIN" } })).resolves.toBe(1);
  });

  it("allows only one administrator when two bootstrap attempts race", async () => {
    const attempts = await Promise.allSettled([
      bootstrapFirstAdmin(
        {
          name: "First Administrator",
          email: "first@example.test",
          password: "first-secret",
        },
        prisma,
      ),
      bootstrapFirstAdmin(
        {
          name: "Second Administrator",
          email: "second@example.test",
          password: "second-secret",
        },
        prisma,
      ),
    ]);

    const fulfilled = attempts.filter(
      (attempt): attempt is PromiseFulfilledResult<Awaited<ReturnType<typeof bootstrapFirstAdmin>>> =>
        attempt.status === "fulfilled",
    );
    const rejected = attempts.filter(
      (attempt): attempt is PromiseRejectedResult => attempt.status === "rejected",
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(ConflictError);
    await expect(prisma.user.count({ where: { role: "ADMIN" } })).resolves.toBe(1);
  });

  it("rejects invalid input without persisting a user or exposing password details", async () => {
    const secret = "not-to-be-exposed";

    await expect(
      bootstrapFirstAdmin(
        { name: " ", email: "not-an-email", password: secret, role: "ADMIN" },
        prisma,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(prisma.user.count()).resolves.toBe(0);
  });
});
