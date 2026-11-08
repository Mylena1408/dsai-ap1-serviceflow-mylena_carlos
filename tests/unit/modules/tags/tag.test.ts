import { describe, expect, it } from "vitest";
import { ConflictError, ValidationError } from "@/server/errors";
import {
  MAX_ACTIVE_TAGS_PER_SECTOR,
  MAX_TAGS_PER_REQUEST,
  TAG_COLORS,
  TAG_COLOR_KEYS,
  assertTagRoom,
  canManageSectorTags,
  contrastRatio,
  planTagChange,
  tagInputSchema,
  type TagActor,
} from "@/modules/tags";

// SPEC 2026-11-08-atendimento-dia-a-dia, 3.3 items 1 and 2 (SF-194; CA-ETQ-02 and 03 by the rules).

const S = "ti";
const ana: TagActor = { id: "ana", role: "ATTENDANT", isActive: true, sectorId: S };
const tags = new Map([
  ["urgente", { sectorId: S, isActive: true }],
  ["rede", { sectorId: S, isActive: true }],
  ["antiga", { sectorId: S, isActive: false }],
  ["outro", { sectorId: "rh", isActive: true }],
]);

describe("the palette (decision I3)", () => {
  it("has 8 colors, each with a contrast of at least 4.5:1 between its text and background", () => {
    expect(TAG_COLOR_KEYS).toEqual(["gray", "red", "orange", "yellow", "green", "teal", "blue", "purple"]);
    for (const color of Object.values(TAG_COLORS)) {
      expect(contrastRatio(color.text, color.background)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
  });
});

describe("the sector's tags (3.3 item 1)", () => {
  it("a name of 1 to 30 characters and a color of the palette", () => {
    expect(tagInputSchema.parse({ name: "  Rede  ", color: "blue" })).toEqual({ name: "Rede", color: "blue" });
    for (const input of [{ name: "", color: "blue" }, { name: "x".repeat(31), color: "blue" }, { name: "Rede", color: "pink" }, { name: "Rede", color: "blue", sectorId: "x" }]) {
      expect(tagInputSchema.safeParse(input).success).toBe(false);
    }
  });

  it("the administrator manages every sector's, a manager their own", () => {
    expect(canManageSectorTags({ id: "a", role: "ADMIN", isActive: true, sectorId: null }, S)).toBe(true);
    expect(canManageSectorTags({ id: "g", role: "MANAGER", isActive: true, sectorId: S }, S)).toBe(true);
    expect(canManageSectorTags({ id: "g", role: "MANAGER", isActive: true, sectorId: "rh" }, S)).toBe(false);
    expect(canManageSectorTags(ana, S)).toBe(false);
    expect(canManageSectorTags({ id: "a", role: "ADMIN", isActive: false, sectorId: null }, S)).toBe(false);
  });

  it(`up to ${MAX_ACTIVE_TAGS_PER_SECTOR} active tags per sector`, () => {
    expect(() => assertTagRoom(MAX_ACTIVE_TAGS_PER_SECTOR - 1)).not.toThrow();
    expect(() => assertTagRoom(MAX_ACTIVE_TAGS_PER_SECTOR)).toThrow(ValidationError);
  });
});

describe("tags on a request (3.3 item 2)", () => {
  const request = { sectorId: S, status: "IN_PROGRESS" as const, tagIds: ["rede"] };

  it("adds the sector's active tags and removes the ones it has, ignoring repeats and no-ops", () => {
    expect(planTagChange(ana, request, { add: ["urgente", "urgente", "rede"], remove: ["rede", "inexistente"] }, tags)).toEqual({
      add: ["urgente"],
      remove: ["rede"],
    });
  });

  it("only an attendant of the request's current sector, on a request not cancelled", () => {
    for (const actor of [
      { ...ana, sectorId: "rh" },
      { ...ana, role: "MANAGER" as const },
      { ...ana, isActive: false },
    ]) {
      expect(() => planTagChange(actor, request, { add: ["urgente"], remove: [] }, tags)).toThrow(ValidationError);
    }
    expect(() => planTagChange(ana, { ...request, status: "CANCELLED" }, { add: ["urgente"], remove: [] }, tags)).toThrow(ConflictError);
    expect(() => planTagChange(ana, { ...request, status: "COMPLETED" }, { add: ["urgente"], remove: [] }, tags)).not.toThrow();
  });

  it("refuses inactive tags and other sectors', but a former sector's tag can be removed (decision I4)", () => {
    for (const id of ["antiga", "outro", "inexistente"]) {
      expect(() => planTagChange(ana, request, { add: [id], remove: [] }, tags)).toThrow(ValidationError);
    }
    expect(planTagChange(ana, { ...request, tagIds: ["outro"] }, { add: [], remove: ["outro"] }, tags)).toEqual({ add: [], remove: ["outro"] });
  });

  it(`keeps at most ${MAX_TAGS_PER_REQUEST} tags`, () => {
    const many = new Map(Array.from({ length: 7 }, (_, index) => [`t${index}`, { sectorId: S, isActive: true }]));
    const full = { ...request, tagIds: ["t0", "t1", "t2", "t3", "t4"] };
    expect(() => planTagChange(ana, full, { add: ["t5"], remove: [] }, many)).toThrow(ValidationError);
    expect(planTagChange(ana, full, { add: ["t5"], remove: ["t0"] }, many)).toEqual({ add: ["t5"], remove: ["t0"] });
  });
});
