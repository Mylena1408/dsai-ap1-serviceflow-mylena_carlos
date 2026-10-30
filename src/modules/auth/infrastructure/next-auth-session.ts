import type { PrismaClient } from "@prisma/client";
import type { Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { prisma } from "@/server/db";
import type { AuthRole } from "../application/ports";
import { createPrismaAuthUserRepository } from "./prisma-auth-repository";

const ROLES = new Set<string>(["ADMIN", "REQUESTER", "ATTENDANT"]);

function isRole(value: unknown): value is AuthRole {
  return typeof value === "string" && ROLES.has(value);
}

export async function refreshSessionToken(
  token: JWT,
  userId: string | undefined,
  database: PrismaClient = prisma,
): Promise<JWT> {
  const id = userId ?? token.sub;

  if (!id) {
    return invalidateSessionToken(token);
  }

  const user = await createPrismaAuthUserRepository(database).findSessionUser(id);

  if (!user?.isActive) {
    return invalidateSessionToken(token);
  }

  return {
    ...token,
    sub: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    sectorId: user.sectorId,
    isActive: user.isActive,
  };
}

export function sessionFromToken(session: Session, token: JWT): Session {
  if (
    !token.sub ||
    !isRole(token.role) ||
    typeof token.isActive !== "boolean" ||
    !token.isActive ||
    (token.sectorId !== null && typeof token.sectorId !== "string")
  ) {
    session.user = null;
    return session;
  }

  session.user = {
    id: token.sub,
    name: token.name ?? null,
    email: token.email ?? null,
    image: session.user?.image ?? null,
    role: token.role,
    sectorId: token.sectorId,
    isActive: token.isActive,
  };

  return session;
}

function invalidateSessionToken(token: JWT): JWT {
  const invalidatedToken = { ...token };
  delete invalidatedToken.sub;
  delete invalidatedToken.role;
  delete invalidatedToken.sectorId;
  delete invalidatedToken.isActive;
  delete invalidatedToken.name;
  delete invalidatedToken.email;
  return invalidatedToken;
}
