import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../../../src/modules/auth/infrastructure/argon2-password";
import { ownPasswordChangeInputSchema } from "@/modules/auth/application/password-schemas";

describe("Argon2id password helpers", () => {
  it("stores passwords as Argon2id hashes and verifies credentials", async () => {
    const hash = await hashPassword("correct-password");

    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(hash, "correct-password")).resolves.toBe(true);
    await expect(verifyPassword(hash, "wrong-password")).resolves.toBe(false);
  });

  it("rejects empty passwords and malformed or non-Argon2id hashes", async () => {
    await expect(hashPassword("")).rejects.toThrow("Password must not be empty.");
    await expect(verifyPassword("plaintext", "plaintext")).resolves.toBe(false);
    await expect(verifyPassword("$argon2id$malformed", "password")).resolves.toBe(false);
  });

  it("validates a minimum-length new password and matching confirmation", () => {
    const valid = {
      currentPassword: "current-secret",
      newPassword: "new-password-12",
      confirmPassword: "new-password-12",
    };

    expect(ownPasswordChangeInputSchema.safeParse(valid).success).toBe(true);
    expect(
      ownPasswordChangeInputSchema.safeParse({
        ...valid,
        newPassword: "short",
        confirmPassword: "short",
      }).success,
    ).toBe(false);
    expect(
      ownPasswordChangeInputSchema.safeParse({
        ...valid,
        confirmPassword: "different-password",
      }).success,
    ).toBe(false);
    expect(
      ownPasswordChangeInputSchema.safeParse({
        ...valid,
        userId: "another-user",
      }).success,
    ).toBe(false);
  });
});
