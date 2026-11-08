import { actorHasPermission, requireCurrentActor } from "@/server/authorization";
import type { DistributionMode } from "../domain/distribution";

// "Carga da equipe" (SPEC 2026-11-07-operacao-e-automacao, 4.3 item 8): the active requests each
// attendant holds, the sector's limit and who is absent today. The sector's manager and whoever
// supervises its queue see their sector; the administrator sees every sector. Others see nothing.

export interface TeamMemberLoad {
  id: string;
  name: string;
  /** Open and in-progress requests held now. */
  activeRequests: number;
  absentToday: boolean;
}

export interface SectorLoad {
  sectorId: string;
  sectorName: string;
  mode: DistributionMode;
  maxActivePerAttendant: number | null;
  /** Requests open in the queue without an assignee. */
  unassigned: number;
  members: TeamMemberLoad[];
}

export interface TeamLoadReader {
  /** Active sectors (one when `sectorId` is given), each with its active attendants by name. */
  loads(sectorId: string | null): Promise<SectorLoad[]>;
}

/** Null when the reader may not see any sector's load. */
export async function getTeamLoad(reader: TeamLoadReader): Promise<SectorLoad[] | null> {
  const actor = await requireCurrentActor();
  if (actor.role === "ADMIN") return reader.loads(null);
  if (actor.sectorId === null) return null;
  if (actor.role === "MANAGER") return reader.loads(actor.sectorId);
  if (actor.role === "ATTENDANT" && (await actorHasPermission(actor, "QUEUE_SUPERVISION"))) return reader.loads(actor.sectorId);
  return null;
}

/** Whether a member is at the sector's limit. */
export function atLimit(member: Pick<TeamMemberLoad, "activeRequests">, load: Pick<SectorLoad, "maxActivePerAttendant">): boolean {
  return load.maxActivePerAttendant !== null && member.activeRequests >= load.maxActivePerAttendant;
}
