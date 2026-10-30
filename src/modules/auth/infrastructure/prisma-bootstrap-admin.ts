import type { PrismaClient } from "@prisma/client";
import * as bootstrap from "../application/bootstrap-admin";
import { argon2PasswordHasher } from "./argon2-password";
import { createPrismaAdministratorBootstrapStore } from "./prisma-auth-repository";

export type { BootstrapAdminResult } from "../application/bootstrap-admin";

// Composed without @/server/db so the CLI scripts can load their environment first.
export function bootstrapFirstAdmin(
  input: unknown,
  database: PrismaClient,
): Promise<bootstrap.BootstrapAdminResult> {
  return bootstrap.bootstrapFirstAdmin(
    input,
    createPrismaAdministratorBootstrapStore(database),
    argon2PasswordHasher,
  );
}
