import { z } from "zod";
import { ConflictError, ValidationError } from "@/server/errors";
import { calendarDayError } from "@/shared/time";
import { entityIdSchema } from "@/shared/validation";

// A manager's absence with a substitute (SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.5,
// decision G5). Days are the organization's calendar days ("YYYY-MM-DD"), both inclusive.

export const MAX_ABSENCE_DAYS = 90;

const daySchema = z.string().refine((value) => calendarDayError(value) === null);

export const absenceInputSchema = z
  .object({
    /** Only the administrator names the manager; a manager registers their own absence. */
    managerId: entityIdSchema.optional(),
    substituteId: entityIdSchema,
    startsOn: daySchema,
    endsOn: daySchema,
  })
  .strict();

export type AbsenceInput = z.output<typeof absenceInputSchema>;

export interface AbsencePeriod {
  startsOn: string;
  endsOn: string;
}

export interface AbsenceRecord extends AbsencePeriod {
  id: string;
  manager: { id: string; name: string; sectorName: string | null };
  substitute: { id: string; name: string; sectorName: string | null };
  createdAt: Date;
  cancelledAt: Date | null;
}

/** Days of a period, both ends included. */
export function absenceDays(period: AbsencePeriod): number {
  return Math.round((Date.parse(`${period.endsOn}T00:00:00Z`) - Date.parse(`${period.startsOn}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * 4.3.5: the end is not before the start, the period has at most 90 days and has not ended yet
 * (a period entirely in the past would change nothing).
 */
export function assertAbsencePeriod(period: AbsencePeriod, today: string): void {
  if (period.endsOn < period.startsOn) {
    throw new ValidationError([{ path: ["endsOn"], code: "too_small" }]);
  }
  if (absenceDays(period) > MAX_ABSENCE_DAYS) {
    throw new ValidationError([{ path: ["endsOn"], code: "too_big" }]);
  }
  if (period.endsOn < today) {
    throw new ValidationError([{ path: ["endsOn"], code: "too_small" }]);
  }
}

export function periodsOverlap(left: AbsencePeriod, right: AbsencePeriod): boolean {
  return left.startsOn <= right.endsOn && right.startsOn <= left.endsOn;
}

/**
 * 4.3.5: the periods of the same manager do not overlap, and the substitute is not absent during
 * the whole period (then nobody would decide). Both compare only the absences not cancelled.
 */
export function assertAbsenceFits(
  period: AbsencePeriod,
  managerAbsences: readonly AbsencePeriod[],
  substituteAbsences: readonly AbsencePeriod[],
): void {
  if (managerAbsences.some((other) => periodsOverlap(period, other))) {
    throw new ConflictError();
  }
  if (substituteAbsences.some((other) => other.startsOn <= period.startsOn && other.endsOn >= period.endsOn)) {
    throw new ConflictError();
  }
}

/** A cancelled absence or one that already ended is not cancelled again (4.3.5). */
export function canCancelAbsence(absence: { cancelledAt: Date | null; endsOn: string }, today: string): boolean {
  return absence.cancelledAt === null && absence.endsOn >= today;
}

/** Whether the absence is in force on a day. */
export function absenceInForce(absence: { cancelledAt: Date | null } & AbsencePeriod, day: string): boolean {
  return absence.cancelledAt === null && absence.startsOn <= day && day <= absence.endsOn;
}
