import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import * as credentials from "../application/authenticate-credentials";
import { argon2PasswordHasher } from "./argon2-password";
import { createPrismaAuthUserRepository } from "./prisma-auth-repository";

export type { AuthenticatedCredentials } from "../application/authenticate-credentials";

// Kept apart from the password change composition, which depends on the session
// (@/server/authorization → Auth.js), so credential checks load without Auth.js.
export function authenticateCredentials(
  input: unknown,
  database: PrismaClient = prisma,
): Promise<credentials.AuthenticatedCredentials | null> {
  return credentials.authenticateCredentials(
    input,
    createPrismaAuthUserRepository(database),
    argon2PasswordHasher,
  );
}
