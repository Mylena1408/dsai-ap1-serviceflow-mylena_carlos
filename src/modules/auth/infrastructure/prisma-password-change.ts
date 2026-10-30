import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import * as passwordChange from "../application/change-own-password";
import { argon2PasswordHasher } from "./argon2-password";
import { createPrismaAuthUserRepository } from "./prisma-auth-repository";

export { CurrentPasswordMismatchError } from "../application/change-own-password";

export function changeOwnPassword(input: unknown, database: PrismaClient = prisma): Promise<void> {
  return passwordChange.changeOwnPassword(
    input,
    createPrismaAuthUserRepository(database),
    argon2PasswordHasher,
  );
}
