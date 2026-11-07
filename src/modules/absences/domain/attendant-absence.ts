import { z } from "zod";
import { ConflictError } from "@/server/errors";
import { calendarDayError } from "@/shared/time";
import { entityIdSchema } from "@/shared/validation";
import { absenceInForce, assertAbsencePeriod, periodsOverlap, type AbsencePeriod } from "./absence";

// An attendant's absence (SPEC 2026-11-07-operacao-e-automacao, 4.3 item 7): the same period rules as a
// manager's absence (up to 90 days, not over yet, no overlap for the same person), without a
// substitute. During it, only the distribution skips the person (decision H8).

const daySchema = z.string().refine((value) => calendarDayError(value) === null);

export const attendantAbsenceInputSchema = z
  .object({
    /** The administrator or the sector's manager names the attendant; an attendant registers their own. */
    userId: entityIdSchema.optional(),
    startsOn: daySchema,
    endsOn: daySchema,
  })
  .strict();

export type AttendantAbsenceInput = z.output<typeof attendantAbsenceInputSchema>;

export interface AttendantAbsencePeriod extends AbsencePeriod {
  cancelledAt: Date | null;
}

/** 4.3 item 7: the period rules of 4.3.5 and no overlap with the person's other absences. */
export function assertAttendantAbsence(period: AbsencePeriod, today: string, others: readonly AttendantAbsencePeriod[]): void {
  assertAbsencePeriod(period, today);
  if (others.some((other) => other.cancelledAt === null && periodsOverlap(period, other))) {
    throw new ConflictError();
  }
}

/** Whether the person is absent on a day (only absences not cancelled count). */
export function absentOn(absences: readonly AttendantAbsencePeriod[], day: string): boolean {
  return absences.some((absence) => absenceInForce(absence, day));
}

/**
 * 4.3 item 7: who registers an attendant's absence: the administrator for anyone, the manager for
 * the attendants of their sector, and the attendant for themselves.
 */
export function canRegisterFor(
  actor: { id: string; role: "ADMIN" | "REQUESTER" | "ATTENDANT" | "MANAGER"; sectorId: string | null },
  attendant: { id: string; role: "ADMIN" | "REQUESTER" | "ATTENDANT" | "MANAGER"; isActive: boolean; sectorId: string | null },
): boolean {
  if (attendant.role !== "ATTENDANT" || !attendant.isActive) return false;
  if (actor.role === "ADMIN") return true;
  if (actor.role === "MANAGER") return actor.sectorId !== null && actor.sectorId === attendant.sectorId;
  return actor.role === "ATTENDANT" && actor.id === attendant.id;
}
