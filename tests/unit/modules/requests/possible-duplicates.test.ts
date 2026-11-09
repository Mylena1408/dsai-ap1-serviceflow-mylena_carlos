import { describe, expect, it } from "vitest";
import {
  MAX_POSSIBLE_DUPLICATES,
  isPossibleDuplicate,
  possibleDuplicateWindow,
  possibleDuplicates,
  type DuplicateCandidate,
} from "@/modules/requests/domain/possible-duplicates";

// SPEC 2026-11-08-atendimento-dia-a-dia, 13.5 item 1 (SF-232; decision J9; CA-DUP-04, suggestions).

const DAY = 24 * 60 * 60 * 1000;
const at = new Date("2026-11-09T12:00:00.000Z");
const base: DuplicateCandidate = { id: "base", requesterId: "lia", serviceId: "cadeira", status: "OPEN", createdAt: at };
const candidate = (id: string, days: number, changes: Partial<DuplicateCandidate> = {}): DuplicateCandidate => ({
  ...base,
  id,
  createdAt: new Date(at.getTime() + days * DAY),
  ...changes,
});

describe("possible duplicates (rule 1)", () => {
  it("same requester and service, open or in progress, up to 7 days before or after", () => {
    expect(isPossibleDuplicate(base, candidate("a", -7))).toBe(true);
    expect(isPossibleDuplicate(base, candidate("b", 7))).toBe(true);
    expect(isPossibleDuplicate(base, candidate("c", 2, { status: "IN_PROGRESS" }))).toBe(true);
  });

  it("leaves out itself, others' requests, other services, the closed ones and those beyond the window", () => {
    expect(isPossibleDuplicate(base, base)).toBe(false);
    expect(isPossibleDuplicate(base, candidate("d", 1, { requesterId: "rita" }))).toBe(false);
    expect(isPossibleDuplicate(base, candidate("e", 1, { serviceId: "mesa" }))).toBe(false);
    expect(isPossibleDuplicate(base, candidate("f", 1, { status: "COMPLETED" }))).toBe(false);
    expect(isPossibleDuplicate(base, candidate("g", 1, { status: "CANCELLED" }))).toBe(false);
    expect(isPossibleDuplicate(base, candidate("h", 7.01))).toBe(false);
    expect(isPossibleDuplicate(base, candidate("i", -7.01))).toBe(false);
    // A request without a service (its service was removed) has nothing to compare.
    expect(isPossibleDuplicate({ ...base, serviceId: null }, candidate("j", 1, { serviceId: null }))).toBe(false);
  });

  it("drops the linked ones, puts the closest first and keeps at most 5", () => {
    const list = [candidate("far", -6), candidate("near", 1), candidate("linked", 0.5), ...[2, 3, 4, 5, -5].map((days) => candidate(`d${days}`, days))];
    const result = possibleDuplicates(base, list, new Set(["linked"]));
    expect(result).toHaveLength(MAX_POSSIBLE_DUPLICATES);
    expect(result.map(({ id }) => id)).toEqual(["near", "d2", "d3", "d4", "d-5"]);
  });

  it("at the same distance, the older one comes first", () => {
    expect(possibleDuplicates(base, [candidate("after", 1), candidate("before", -1)], new Set()).map(({ id }) => id)).toEqual(["before", "after"]);
  });

  it("reads a 14-day window around the request from the database", () => {
    expect(possibleDuplicateWindow(at)).toEqual({ from: new Date(at.getTime() - 7 * DAY), to: new Date(at.getTime() + 7 * DAY) });
  });
});
