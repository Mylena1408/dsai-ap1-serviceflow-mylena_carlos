import type { Role } from "@prisma/client";
import {
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
} from "@/server/errors";

export interface AuthorizationActor {
  id: string;
  role: Role;
  sectorId: string | null;
  isActive: boolean;
}

export interface RequestAuthorizationScope {
  requesterId: string;
  sectorId: string;
  /** SPEC 2026-11-01-aprovacoes, 5.8: managers read only requests that require approval. */
  requiresApproval?: boolean;
}

export interface AuthorizedStatusActor {
  actorId: string;
  sectorId: string;
}

export function assertActiveActor(
  actor: AuthorizationActor | null,
): AuthorizationActor {
  if (!actor?.id || !actor.isActive) {
    throw new AuthenticationError();
  }

  return actor;
}

export function assertRole(
  actor: AuthorizationActor | null,
  requiredRole: Role,
): AuthorizationActor {
  const activeActor = assertActiveActor(actor);

  if (activeActor.role !== requiredRole) {
    throw new AuthorizationError();
  }

  return activeActor;
}

export function assertRequestReadable(
  actor: AuthorizationActor | null,
  request: RequestAuthorizationScope,
): AuthorizationActor {
  const activeActor = assertActiveActor(actor);
  const canRead =
    (activeActor.role === "REQUESTER" &&
      request.requesterId === activeActor.id) ||
    (activeActor.role === "ATTENDANT" &&
      activeActor.sectorId !== null &&
      request.sectorId === activeActor.sectorId) ||
    (activeActor.role === "MANAGER" &&
      activeActor.sectorId !== null &&
      request.sectorId === activeActor.sectorId &&
      request.requiresApproval === true);

  if (!canRead) {
    throw new NotFoundError();
  }

  return activeActor;
}

export function assertStatusChangeAllowed(
  actor: AuthorizationActor | null,
  request: RequestAuthorizationScope,
): AuthorizedStatusActor {
  const activeActor = assertActiveActor(actor);

  if (
    activeActor.role !== "ATTENDANT" ||
    activeActor.sectorId === null ||
    request.sectorId !== activeActor.sectorId
  ) {
    throw new NotFoundError();
  }

  return {
    actorId: activeActor.id,
    sectorId: activeActor.sectorId,
  };
}
