import { describe, expect, it } from "vitest";
import { ConflictError, ValidationError } from "@/server/errors";
import { chooseAttendant, compareByName, unavailableReason, type DistributionCandidate } from "@/modules/requests/domain/distribution";
import { distributionSettingsSchema, distributionSummary } from "@/modules/sectors/domain/distribution-config";
import { absentOn, assertAttendantAbsence, attendantAbsenceInputSchema, canRegisterFor } from "@/modules/absences/domain/attendant-absence";
import { auditValueFormatter } from "@/app/(admin)/admin/_sections/audit/audit-section";

// SPEC 2026-11-07-operacao-e-automacao, 4.3 items 1, 3, 4 and 7 (SF-180; CA-DST-02 to 05 by the rules).

const sector = "ti";
const person = (id: string, name: string, overrides: Partial<DistributionCandidate> = {}): DistributionCandidate => ({
  id,
  name,
  role: "ATTENDANT",
  isActive: true,
  sectorId: sector,
  activeRequests: 0,
  absentToday: false,
  ...overrides,
});

const ana = person("a", "Ana", { activeRequests: 3 });
const bia = person("b", "Bia", { activeRequests: 1 });
const caio = person("c", "Caio", { activeRequests: 1 });
const team = [caio, ana, bia];

describe("who may receive (4.3 item 3)", () => {
  it("only active attendants of the sector, not absent and below the limit", () => {
    expect(unavailableReason(ana, sector, null)).toBeNull();
    expect(unavailableReason(ana, sector, 3)).toBe("full");
    expect(unavailableReason(ana, sector, 4)).toBeNull();
    expect(unavailableReason({ ...ana, isActive: false }, sector, null)).toBe("inactive");
    expect(unavailableReason({ ...ana, role: "MANAGER" }, sector, null)).toBe("not_attendant");
    expect(unavailableReason({ ...ana, sectorId: "rh" }, sector, null)).toBe("other_sector");
    expect(unavailableReason({ ...ana, absentToday: true }, sector, null)).toBe("absent");
  });

  it("orders by name, then id", () => {
    expect([caio, ana, bia, person("a2", "Ana")].sort(compareByName).map(({ id }) => id)).toEqual(["a", "a2", "b", "c"]);
  });
});

describe("who receives (4.3 item 4)", () => {
  const settings = { mode: "ROUND_ROBIN" as const, maxActivePerAttendant: null, lastDistributedToId: null };

  it("does nothing while the distribution is off", () => {
    expect(chooseAttendant({ ...settings, mode: "NONE" }, sector, team)).toBeNull();
  });

  it("round-robin: the next after the last one who received, skipping who may not", () => {
    expect(chooseAttendant(settings, sector, team)?.id).toBe("a");
    expect(chooseAttendant({ ...settings, lastDistributedToId: "a" }, sector, team)?.id).toBe("b");
    expect(chooseAttendant({ ...settings, lastDistributedToId: "c" }, sector, team)?.id).toBe("a");
    expect(chooseAttendant({ ...settings, lastDistributedToId: "a" }, sector, [caio, ana, { ...bia, absentToday: true }])?.id).toBe("c");
    expect(chooseAttendant({ ...settings, lastDistributedToId: "a", maxActivePerAttendant: 1 }, sector, team)).toBeNull();
    // Someone who left the sector: the turn starts again from the first name.
    expect(chooseAttendant({ ...settings, lastDistributedToId: "gone" }, sector, team)?.id).toBe("a");
    // The person who released the request is skipped (4.3 item 2).
    expect(chooseAttendant({ ...settings, lastDistributedToId: "a" }, sector, team, new Set(["b"]))?.id).toBe("c");
  });

  it("least load: who has fewer active requests, a tie in round-robin order", () => {
    const least = { ...settings, mode: "LEAST_LOAD" as const };
    expect(chooseAttendant(least, sector, team)?.id).toBe("b");
    expect(chooseAttendant({ ...least, lastDistributedToId: "b" }, sector, team)?.id).toBe("c");
    expect(chooseAttendant({ ...least, maxActivePerAttendant: 1 }, sector, team)).toBeNull();
    expect(chooseAttendant(least, sector, [ana])?.id).toBe("a");
    expect(chooseAttendant(least, sector, [])).toBeNull();
  });

  it("never picks someone of another sector or another profile", () => {
    expect(chooseAttendant(settings, sector, [person("x", "Xavier", { sectorId: "rh" }), person("m", "Maria", { role: "MANAGER" })])).toBeNull();
  });
});

describe("distribution settings of a sector (4.3 item 1)", () => {
  it("reads the form: mode, a blank limit as none and the flag", () => {
    expect(distributionSettingsSchema.parse({ distributionMode: "ROUND_ROBIN", maxActivePerAttendant: "", redistributeOnAbsence: "true" })).toEqual({
      distributionMode: "ROUND_ROBIN",
      maxActivePerAttendant: null,
      redistributeOnAbsence: true,
    });
    expect(distributionSettingsSchema.parse({ distributionMode: "LEAST_LOAD", maxActivePerAttendant: "5" })).toEqual({
      distributionMode: "LEAST_LOAD",
      maxActivePerAttendant: 5,
      redistributeOnAbsence: false,
    });
    for (const input of [
      { distributionMode: "RANDOM" },
      { distributionMode: "NONE", maxActivePerAttendant: 0 },
      { distributionMode: "NONE", maxActivePerAttendant: 101 },
      { distributionMode: "NONE", maxActivePerAttendant: "2.5" },
      { distributionMode: "NONE", extra: 1 },
    ]) {
      expect(distributionSettingsSchema.safeParse(input).success).toBe(false);
    }
  });

  it("summarizes the settings and shows them by name in the audit trail", () => {
    expect(distributionSummary({ distributionMode: "NONE", maxActivePerAttendant: 3, redistributeOnAbsence: true })).toBe("Desligada");
    expect(distributionSummary({ distributionMode: "ROUND_ROBIN", maxActivePerAttendant: 5, redistributeOnAbsence: true })).toBe(
      "Rodízio · até 5 por atendente · passa as solicitações de quem se ausenta",
    );
    expect(distributionSummary({ distributionMode: "LEAST_LOAD", maxActivePerAttendant: null, redistributeOnAbsence: false })).toBe("Menor carga · sem limite");
    const format = auditValueFormatter({});
    expect(format("distributionMode", "LEAST_LOAD")).toBe("Menor carga");
    expect(format("maxActivePerAttendant", null)).toBe("Sem limite");
    expect(format("maxActivePerAttendant", 5)).toBeUndefined();
  });
});

describe("an attendant's absence (4.3 item 7)", () => {
  const today = "2026-11-07";

  it("follows the period rules and does not overlap the person's other absences", () => {
    expect(attendantAbsenceInputSchema.safeParse({ startsOn: "2026-11-10", endsOn: "2026-11-12" }).success).toBe(true);
    expect(attendantAbsenceInputSchema.safeParse({ startsOn: "10/11/2026", endsOn: "2026-11-12" }).success).toBe(false);
    expect(() => assertAttendantAbsence({ startsOn: "2026-11-10", endsOn: "2026-11-12" }, today, [])).not.toThrow();
    expect(() => assertAttendantAbsence({ startsOn: "2026-11-12", endsOn: "2026-11-10" }, today, [])).toThrow(ValidationError);
    expect(() => assertAttendantAbsence({ startsOn: "2026-11-01", endsOn: "2026-11-06" }, today, [])).toThrow(ValidationError);
    expect(() => assertAttendantAbsence({ startsOn: "2026-11-10", endsOn: "2027-03-01" }, today, [])).toThrow(ValidationError);
    const other = { startsOn: "2026-11-11", endsOn: "2026-11-20", cancelledAt: null };
    expect(() => assertAttendantAbsence({ startsOn: "2026-11-10", endsOn: "2026-11-12" }, today, [other])).toThrow(ConflictError);
    expect(() => assertAttendantAbsence({ startsOn: "2026-11-10", endsOn: "2026-11-12" }, today, [{ ...other, cancelledAt: new Date() }])).not.toThrow();
  });

  it("is absent on the days of an absence not cancelled", () => {
    const absences = [{ startsOn: "2026-11-10", endsOn: "2026-11-12", cancelledAt: null }];
    expect(absentOn(absences, "2026-11-10")).toBe(true);
    expect(absentOn(absences, "2026-11-12")).toBe(true);
    expect(absentOn(absences, "2026-11-13")).toBe(false);
    expect(absentOn([{ ...absences[0], cancelledAt: new Date() }], "2026-11-11")).toBe(false);
  });

  it("is registered by the administrator, the sector's manager or the attendant", () => {
    const attendant = { id: "a", role: "ATTENDANT" as const, isActive: true, sectorId: sector };
    expect(canRegisterFor({ id: "adm", role: "ADMIN", sectorId: null }, attendant)).toBe(true);
    expect(canRegisterFor({ id: "g", role: "MANAGER", sectorId: sector }, attendant)).toBe(true);
    expect(canRegisterFor({ id: "g", role: "MANAGER", sectorId: "rh" }, attendant)).toBe(false);
    expect(canRegisterFor({ id: "a", role: "ATTENDANT", sectorId: sector }, attendant)).toBe(true);
    expect(canRegisterFor({ id: "b", role: "ATTENDANT", sectorId: sector }, attendant)).toBe(false);
    expect(canRegisterFor({ id: "r", role: "REQUESTER", sectorId: null }, attendant)).toBe(false);
    expect(canRegisterFor({ id: "adm", role: "ADMIN", sectorId: null }, { ...attendant, isActive: false })).toBe(false);
    expect(canRegisterFor({ id: "adm", role: "ADMIN", sectorId: null }, { ...attendant, role: "MANAGER" })).toBe(false);
  });
});
