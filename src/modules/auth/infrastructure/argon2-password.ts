import argon2 from "argon2";
import type { PasswordHasher } from "../application/ports";

export async function hashPassword(password: string): Promise<string> {
  if (!password) {
    throw new Error("Password must not be empty.");
  }

  return argon2.hash(password, {
    type: argon2.argon2id,
  });
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  if (!passwordHash.startsWith("$argon2id$")) {
    return false;
  }

  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    return false;
  }
}

export const argon2PasswordHasher: PasswordHasher = {
  hash: hashPassword,
  verify: verifyPassword,
};
