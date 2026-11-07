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
  /**
   * SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.4: sectors of the approval levels (the
   * request's own sector before levels). Optional: absent means only the request's sector.
   */
  approvalSectorIds?: readonly string[];
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
  /**
   * A manager with "Ver todas as solicitações do setor" (SPEC de permissões, 5.3.2), and the sectors
   * of absent managers this manager replaces today (SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.5).
   */
  options: { sectorReader?: boolean; coveredSectorIds?: readonly string[] } = {},
): AuthorizationActor {
  const activeActor = assertActiveActor(actor);
  const managerSectors = activeActor.sectorId === null ? [] : [activeActor.sectorId, ...(options.coveredSectorIds ?? [])];
  const approvalSectors = [request.sectorId, ...(request.approvalSectorIds ?? [])];
  const canRead =
    (activeActor.role === "REQUESTER" &&
      request.requesterId === activeActor.id) ||
    (activeActor.role === "ATTENDANT" &&
      activeActor.sectorId !== null &&
      request.sectorId === activeActor.sectorId) ||
    (activeActor.role === "MANAGER" &&
      activeActor.sectorId !== null &&
      ((request.requiresApproval === true && approvalSectors.some((sectorId) => managerSectors.includes(sectorId))) ||
        (request.sectorId === activeActor.sectorId && options.sectorReader === true)));

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

/**
 * Who configures the catalog (SPEC 2026-11-01-permissoes-configuraveis, 5.3.1): the
 * administrator in every sector (`sectorId` null), or a holder of "Gerir serviços do setor" only
 * in the own sector.
 */
export interface CatalogEditor {
  actor: AuthorizationActor;
  sectorId: string | null;
}

/** Outside the editor's sector, a service "does not exist" (as in the other read rules). */
export function assertCatalogSector(editor: CatalogEditor, sectorId: string): void {
  if (editor.sectorId !== null && editor.sectorId !== sectorId) {
    throw new NotFoundError();
  }
}
