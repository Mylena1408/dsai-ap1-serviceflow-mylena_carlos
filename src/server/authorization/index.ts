import { getCurrentUser } from "@/server/auth";
import { AuthorizationError, NotFoundError } from "@/server/errors";
import { prisma } from "@/server/db";
import { entityIdSchema } from "@/shared/validation";
import { validateInput } from "@/server/validation";
import { hasPermissionInSector, type Permission } from "@/shared/permissions";
import {
  assertActiveActor,
  assertCatalogSector,
  assertRequestReadable,
  assertRole,
  assertStatusChangeAllowed,
  type AuthorizationActor,
  type CatalogEditor,
  type RequestAuthorizationScope,
} from "./policy";

export {
  assertActiveActor,
  assertCatalogSector,
  assertRequestReadable,
  assertRole,
  assertStatusChangeAllowed,
};
export type {
  AuthorizedStatusActor,
  AuthorizationActor,
  CatalogEditor,
  RequestAuthorizationScope,
} from "./policy";

export async function requireCurrentActor(): Promise<AuthorizationActor> {
  return assertActiveActor(await getCurrentUser());
}

export async function requireConfigurationAdministrator(): Promise<AuthorizationActor> {
  return assertRole(await requireCurrentActor(), "ADMIN");
}

/**
 * Whether the actor may use `permission` now (SPEC 2026-11-01-permissoes-configuraveis, 5.2.4):
 * grants are read from the database on every check, so a revocation counts at once.
 */
export async function actorHasPermission(actor: AuthorizationActor, permission: Permission): Promise<boolean> {
  if (actor.sectorId === null) {
    return false;
  }

  const grants = await prisma.userPermission.findMany({ where: { userId: actor.id }, select: { permission: true } });
  return hasPermissionInSector(
    actor,
    grants.map((grant) => grant.permission),
    permission,
    actor.sectorId,
  );
}

/** Administrator (every sector) or holder of "Gerir serviços do setor" (own sector only). */
export async function requireCatalogEditor(): Promise<CatalogEditor> {
  const actor = await requireCurrentActor();

  if (actor.role === "ADMIN") {
    return { actor, sectorId: null };
  }

  if (await actorHasPermission(actor, "SECTOR_SERVICES")) {
    return { actor, sectorId: actor.sectorId };
  }

  throw new AuthorizationError();
}

export async function requirePublishedCatalogReader(): Promise<AuthorizationActor> {
  return assertRole(await requireCurrentActor(), "REQUESTER");
}

export async function requireRequestCreator(): Promise<AuthorizationActor> {
  return assertRole(await requireCurrentActor(), "REQUESTER");
}

export async function requireRequestReader(
  requestId: unknown,
): Promise<AuthorizationActor> {
  const actor = await requireCurrentActor();
  const request = await loadRequestScope(requestId);
  return assertRequestReadable(actor, request);
}

export async function requireStatusChangeActor(
  requestId: unknown,
): Promise<{ actorId: string; sectorId: string }> {
  const actor = await requireCurrentActor();
  const request = await loadRequestScope(requestId);
  return assertStatusChangeAllowed(actor, request);
}

async function loadRequestScope(
  requestId: unknown,
): Promise<RequestAuthorizationScope> {
  const id = validateInput(entityIdSchema, requestId);
  const request = await prisma.request.findUnique({
    where: { id },
    select: { requesterId: true, sectorId: true },
  });

  if (!request) {
    throw new NotFoundError();
  }

  return request;
}
