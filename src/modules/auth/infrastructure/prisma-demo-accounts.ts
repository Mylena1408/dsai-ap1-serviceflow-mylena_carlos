import { randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import * as demo from "../application/demo-sign-in";
import type { AuthenticatedCredentials } from "../application/authenticate-credentials";
import type { DemoAccountStore } from "../application/ports";
import { DEMO_ACCOUNTS, DEMO_SECTOR_NAME } from "../domain/demo-accounts";
import { hashPassword } from "./argon2-password";

const identitySelect = { id: true, name: true, email: true } satisfies Prisma.UserSelect;

async function ensureDemoSector(transaction: Prisma.TransactionClient): Promise<string> {
  const existing = await transaction.sector.findFirst({
    where: { name: DEMO_SECTOR_NAME, isActive: true },
    select: { id: true },
  });

  if (existing) {
    return existing.id;
  }

  const created = await transaction.sector.create({
    data: { name: DEMO_SECTOR_NAME },
    select: { id: true },
  });
  return created.id;
}

export function createPrismaDemoAccountStore(database: PrismaClient): DemoAccountStore {
  return {
    async ensureDemoUser(role) {
      const account = DEMO_ACCOUNTS[role];
      const existing = await database.user.findUnique({
        where: { email: account.email },
        select: { id: true },
      });
      // Demonstration accounts cannot use the e-mail and password form: their hash
      // comes from a random value that is discarded.
      const passwordHash = existing ? undefined : await hashPassword(randomBytes(32).toString("base64"));

      return runSerializableTransaction(
        database,
        async (transaction) => {
          const sectorId =
            role === "ATTENDANT" || role === "MANAGER" ? await ensureDemoSector(transaction) : null;
          const current = await transaction.user.findUnique({
            where: { email: account.email },
            select: { id: true },
          });

          if (current) {
            return transaction.user.update({
              where: { id: current.id },
              data: { name: account.name, role, sectorId, isActive: true },
              select: identitySelect,
            });
          }

          return transaction.user.create({
            data: {
              name: account.name,
              email: account.email,
              role,
              sectorId,
              isActive: true,
              passwordHash: passwordHash ?? (await hashPassword(randomBytes(32).toString("base64"))),
            },
            select: identitySelect,
          });
        },
        { translate: ["P2002", "P2034"], fallbackMessage: "Demo sign-in failed." },
      );
    },
  };
}

export function signInAsDemoUser(
  input: unknown,
  database: PrismaClient = prisma,
): Promise<AuthenticatedCredentials | null> {
  return demo.signInAsDemoUser(input, createPrismaDemoAccountStore(database));
}
