import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./fixtures";
import type { AuthenticatedUser } from "@/server/auth";
import { authenticateCredentials } from "@/modules/auth";
import {
  changeOwnPassword,
  CurrentPasswordMismatchError,
} from "@/modules/auth";
import { hashPassword, verifyPassword } from "@/modules/auth";
import { refreshSessionToken, sessionFromToken } from "@/modules/auth";
import { ValidationError } from "@/server/errors";

const session = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@/server/auth", () => session);

const currentPassword = "current-password-for-test";
const newPassword = "a-new-password-with-12";
let currentHash: string;

beforeAll(async () => {
  currentHash = await hashPassword(currentPassword);
});

beforeEach(() => {
  session.getCurrentUser.mockReset();
});

async function createAccount(role: AuthenticatedUser["role"]) {
  const sector =
    role === "ATTENDANT"
      ? await prisma.sector.create({
          data: { name: `Password sector ${randomUUID()}` },
        })
      : null;
  const user = await prisma.user.create({
    data: {
      name: "Password test user",
      email: `password-${randomUUID()}@example.test`,
      role,
      sectorId: sector?.id,
      passwordHash: currentHash,
      isActive: true,
    },
  });
  const actor: AuthenticatedUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    sectorId: user.sectorId,
    isActive: true,
  };
  session.getCurrentUser.mockResolvedValue(actor);
  return { user, actor };
}

function passwordInput(overrides: Record<string, string> = {}) {
  return {
    currentPassword,
    newPassword,
    confirmPassword: newPassword,
    ...overrides,
  };
}

describe("own password change", () => {
  it.each(["ADMIN", "REQUESTER", "ATTENDANT"] as const)(
    "allows an active %s user to change their own password and remain authenticated",
    async (role) => {
      const { user, actor } = await createAccount(role);

      await expect(
        changeOwnPassword(passwordInput(), prisma),
      ).resolves.toBeUndefined();

      const updated = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { passwordHash: true, isActive: true },
      });
      expect(updated.passwordHash).not.toBe(newPassword);
      expect(updated.passwordHash).not.toBe(currentHash);
      expect(updated.passwordHash).toMatch(/^\$argon2id\$/);
      await expect(verifyPassword(updated.passwordHash, newPassword)).resolves.toBe(true);
      await expect(verifyPassword(updated.passwordHash, currentPassword)).resolves.toBe(false);
      await expect(
        authenticateCredentials(
          { email: user.email, password: newPassword },
          prisma,
        ),
      ).resolves.toMatchObject({ id: user.id });
      await expect(
        authenticateCredentials(
          { email: user.email, password: currentPassword },
          prisma,
        ),
      ).resolves.toBeNull();

      const token = await refreshSessionToken({ sub: user.id }, undefined, prisma);
      expect(
        sessionFromToken(
          { expires: new Date(Date.now() + 60_000).toISOString(), user: null },
          token,
        ).user,
      ).toMatchObject({ id: actor.id, role, isActive: true });
      expect(session.getCurrentUser).toHaveBeenCalled();
    },
  );

  it("rejects an incorrect current password without changing the stored hash", async () => {
    const { user } = await createAccount("REQUESTER");

    await expect(
      changeOwnPassword(
        passwordInput({ currentPassword: "incorrect-current-password" }),
        prisma,
      ),
    ).rejects.toBeInstanceOf(CurrentPasswordMismatchError);
    await expect(
      prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { passwordHash: true },
      }),
    ).resolves.toEqual({ passwordHash: currentHash });
  });

  it.each([
    {
      label: "short new password",
      input: passwordInput({
        newPassword: "too-short",
        confirmPassword: "too-short",
      }),
    },
    {
      label: "mismatched confirmation",
      input: passwordInput({ confirmPassword: "a-different-password" }),
    },
  ])("rejects $label without changing the stored hash", async ({ input }) => {
    const { user } = await createAccount("ATTENDANT");

    await expect(changeOwnPassword(input, prisma)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { passwordHash: true },
      }),
    ).resolves.toEqual({ passwordHash: currentHash });
  });

  it("rejects a forged userId and leaves both the session account and target unchanged", async () => {
    const { user: actor } = await createAccount("ADMIN");
    const target = await prisma.user.create({
      data: {
        name: "Unrelated account",
        email: `target-${randomUUID()}@example.test`,
        role: "REQUESTER",
        passwordHash: currentHash,
      },
    });

    await expect(
      changeOwnPassword(
        { ...passwordInput(), userId: target.id },
        prisma,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      prisma.user.findUniqueOrThrow({
        where: { id: actor.id },
        select: { passwordHash: true },
      }),
    ).resolves.toEqual({ passwordHash: currentHash });
    await expect(
      prisma.user.findUniqueOrThrow({
        where: { id: target.id },
        select: { passwordHash: true },
      }),
    ).resolves.toEqual({ passwordHash: currentHash });
  });
});
