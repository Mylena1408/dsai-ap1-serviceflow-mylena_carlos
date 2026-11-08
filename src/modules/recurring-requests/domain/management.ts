import type { AuthorizationActor } from "@/server/authorization";
import { AuthorizationError, ValidationError } from "@/server/errors";
import { MAX_ACTIVE_SCHEDULES, type scheduleStatus } from "./schedule";

// Who manages the schedules and what each state allows (SPEC 2026-11-07-operacao-e-automacao, 5.3 items 1,
// 2 and 4; decision H11): the administrator for any service, a manager for the services of their sector.

/** The sector whose services the person schedules, or null for every sector. */
export interface ScheduleScope {
  sectorId: string | null;
}

export function scheduleScopeOf(actor: Pick<AuthorizationActor, "role" | "sectorId">): ScheduleScope {
  if (actor.role === "ADMIN") return { sectorId: null };
  if (actor.role === "MANAGER" && actor.sectorId) return { sectorId: actor.sectorId };
  throw new AuthorizationError();
}

export function inScheduleScope(scope: ScheduleScope, sectorId: string): boolean {
  return scope.sectorId === null || scope.sectorId === sectorId;
}

export interface ScheduleServiceState {
  id: string;
  name: string;
  sectorId: string;
  sectorName: string;
  isActive: boolean;
  categoryActive: boolean;
  sectorActive: boolean;
  activeRequirements: number;
}

/** 5.3 item 2: active, in the catalog (its category and sector active) and without active required documents. */
export function serviceSchedulable(service: ScheduleServiceState): boolean {
  return service.isActive && service.categoryActive && service.sectorActive && service.activeRequirements === 0;
}

export interface ScheduleRequester {
  id: string;
  role: AuthorizationActor["role"];
  isActive: boolean;
}

/** 5.3 item 2: the requester is an active user with the Requester profile. */
export function requesterSchedulable(requester: ScheduleRequester | null): boolean {
  return requester !== null && requester.isActive && requester.role === "REQUESTER";
}

/**
 * Decision H22: at most 200 schedules in force (not ended and not past their end, paused ones included, so
 * resuming never goes over the limit).
 */
export function assertScheduleRoom(inForce: number): void {
  if (inForce >= MAX_ACTIVE_SCHEDULES) {
    throw new ValidationError([{ path: [], code: "too_big" }]);
  }
}

export type ScheduleAction = "edit" | "pause" | "resume" | "end";

/** An ended or finished schedule is history: it only shows its runs. */
export function scheduleActions(status: ReturnType<typeof scheduleStatus>): ScheduleAction[] {
  if (status === "active") return ["edit", "pause", "end"];
  if (status === "paused") return ["edit", "resume", "end"];
  return [];
}
