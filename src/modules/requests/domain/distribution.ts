// Automatic distribution of the queue (SPEC 2026-11-07-operacao-e-automacao, 4.3 items 3 and 4,
// decision H6): who may receive a request entering a sector's queue without an assignee, and who
// receives it, by round-robin or by the least load. Pure rules over what the transaction loaded.

export const DISTRIBUTION_MODES = ["NONE", "ROUND_ROBIN", "LEAST_LOAD"] as const;
export type DistributionMode = (typeof DISTRIBUTION_MODES)[number];

export interface DistributionSettings {
  mode: DistributionMode;
  /** 1 to 100, or null without a limit. */
  maxActivePerAttendant: number | null;
  /** The last attendant who received by distribution in the sector (the round-robin's turn). */
  lastDistributedToId: string | null;
}

export interface DistributionCandidate {
  id: string;
  name: string;
  role: "ADMIN" | "REQUESTER" | "ATTENDANT" | "MANAGER";
  isActive: boolean;
  sectorId: string | null;
  /** Open and in-progress requests this person holds now. */
  activeRequests: number;
  /** Absent on the organization's day (4.3 item 7). */
  absentToday: boolean;
}

/** "Ana Souza", "Bruno Lima": the round-robin order is the name, then the id. */
export function compareByName(left: Pick<DistributionCandidate, "id" | "name">, right: Pick<DistributionCandidate, "id" | "name">): number {
  return left.name.localeCompare(right.name, "pt-BR") || left.id.localeCompare(right.id);
}

/** Why a person may not receive now; null when they may. */
export function unavailableReason(
  candidate: DistributionCandidate,
  sectorId: string,
  maxActivePerAttendant: number | null,
): "inactive" | "not_attendant" | "other_sector" | "absent" | "full" | null {
  if (!candidate.isActive) return "inactive";
  if (candidate.role !== "ATTENDANT") return "not_attendant";
  if (candidate.sectorId !== sectorId) return "other_sector";
  if (candidate.absentToday) return "absent";
  if (maxActivePerAttendant !== null && candidate.activeRequests >= maxActivePerAttendant) return "full";
  return null;
}

/** 4.3 item 4: in round-robin order, starting after the last one who received. */
function roundRobinOrder(candidates: readonly DistributionCandidate[], lastId: string | null): DistributionCandidate[] {
  const ordered = [...candidates].sort(compareByName);
  if (lastId === null) return ordered;
  const all = ordered.map(({ id }) => id);
  const lastIndex = all.indexOf(lastId);
  if (lastIndex === -1) {
    // The last one left the sector or was removed: the turn continues from where their name would be.
    return ordered;
  }
  return [...ordered.slice(lastIndex + 1), ...ordered.slice(0, lastIndex + 1)];
}

/**
 * Who receives the request, or null when nobody may (it then stays without an assignee). The
 * people passed are every attendant of the sector, available or not, so the round-robin keeps its
 * order when someone is skipped.
 */
export function chooseAttendant(
  settings: DistributionSettings,
  sectorId: string,
  people: readonly DistributionCandidate[],
  exclude: ReadonlySet<string> = new Set(),
): DistributionCandidate | null {
  if (settings.mode === "NONE") return null;
  const available = (candidate: DistributionCandidate) =>
    !exclude.has(candidate.id) && unavailableReason(candidate, sectorId, settings.maxActivePerAttendant) === null;
  const inTurn = roundRobinOrder(
    people.filter((candidate) => candidate.sectorId === sectorId && candidate.role === "ATTENDANT"),
    settings.lastDistributedToId,
  ).filter(available);

  if (inTurn.length === 0) return null;
  if (settings.mode === "ROUND_ROBIN") return inTurn[0];
  // Least load; a tie keeps the round-robin order.
  const least = Math.min(...inTurn.map(({ activeRequests }) => activeRequests));
  return inTurn.find(({ activeRequests }) => activeRequests === least) ?? null;
}
