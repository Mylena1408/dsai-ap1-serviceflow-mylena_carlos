import { requireCurrentActor, type AuthorizationActor } from "@/server/authorization";
import { AuthorizationError, ConflictError, NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";
import { canCancelAbsence } from "../domain/absence";
import {
  assertAttendantAbsence,
  attendantAbsenceInputSchema,
  canRegisterFor,
  type AttendantAbsencePeriod,
} from "../domain/attendant-absence";

// Attendants' absences (SPEC 2026-11-07-operacao-e-automacao, 4.3 item 7): the administrator registers
// and cancels for any attendant, a manager for the attendants of their sector, and an attendant for
// themselves. During an absence, only the distribution skips the person (decision H8).

export interface AbsencePerson {
  id: string;
  name: string;
  role: AuthorizationActor["role"];
  isActive: boolean;
  sectorId: string | null;
  sectorName: string | null;
}

export interface AttendantAbsenceRecord extends AttendantAbsencePeriod {
  id: string;
  attendant: { id: string; name: string; sectorName: string | null };
  createdBy: { id: string; name: string };
  createdAt: Date;
  /** When the job handed the attendant's requests to colleagues. */
  redistributedAt: Date | null;
}

export interface AttendantAbsenceTransaction {
  today(): Promise<string>;
  findPerson(userId: string): Promise<AbsencePerson | null>;
  absencesOf(userId: string): Promise<AttendantAbsencePeriod[]>;
  findAbsence(absenceId: string): Promise<{ id: string; userId: string; endsOn: string; cancelledAt: Date | null } | null>;
  create(input: { userId: string; startsOn: string; endsOn: string; createdById: string }): Promise<{ id: string }>;
  cancel(absenceId: string): Promise<void>;
}

export interface AttendantAbsenceStore {
  run<T>(work: (transaction: AttendantAbsenceTransaction) => Promise<T>): Promise<T>;
  today(): Promise<string>;
  /** Absences of the attendants in scope (every sector when null, or one person), recent first. */
  list(scope: { sectorId: string | null; userId: string | null }): Promise<AttendantAbsenceRecord[]>;
  /** Active attendants in scope, by name. */
  attendants(sectorId: string | null): Promise<Array<{ id: string; name: string; sectorName: string | null }>>;
}

export interface AttendantAbsenceOverview {
  today: string;
  absences: AttendantAbsenceRecord[];
  /** Whom the reader may register an absence for. */
  attendants: Array<{ id: string; name: string; sectorName: string | null }>;
}

function scopeOf(actor: AuthorizationActor): { sectorId: string | null; userId: string | null } {
  if (actor.role === "ADMIN") return { sectorId: null, userId: null };
  if (actor.role === "MANAGER" && actor.sectorId) return { sectorId: actor.sectorId, userId: null };
  if (actor.role === "ATTENDANT") return { sectorId: null, userId: actor.id };
  throw new AuthorizationError();
}

export async function listAttendantAbsences(store: AttendantAbsenceStore): Promise<AttendantAbsenceOverview> {
  const actor = await requireCurrentActor();
  const scope = scopeOf(actor);
  const [today, absences, attendants] = await Promise.all([
    store.today(),
    store.list(scope),
    scope.userId ? Promise.resolve([]) : store.attendants(scope.sectorId),
  ]);
  return { today, absences, attendants };
}

export async function registerAttendantAbsence(input: unknown, store: AttendantAbsenceStore): Promise<{ id: string }> {
  const actor = await requireCurrentActor();
  scopeOf(actor);
  const parsed = validateInput(attendantAbsenceInputSchema, input);
  const userId = parsed.userId ?? actor.id;

  return store.run(async (transaction) => {
    const attendant = await transaction.findPerson(userId);
    if (!attendant || !canRegisterFor(actor, attendant)) {
      throw new NotFoundError();
    }

    const period = { startsOn: parsed.startsOn, endsOn: parsed.endsOn };
    assertAttendantAbsence(period, await transaction.today(), await transaction.absencesOf(attendant.id));
    return transaction.create({ ...period, userId: attendant.id, createdById: actor.id });
  });
}

/** Cancelling an absence that has not ended; whoever may register for the person may cancel. */
export async function cancelAttendantAbsence(absenceId: unknown, store: AttendantAbsenceStore): Promise<void> {
  const actor = await requireCurrentActor();
  scopeOf(actor);
  const id = validateInput(entityIdSchema, absenceId);

  await store.run(async (transaction) => {
    const absence = await transaction.findAbsence(id);
    const attendant = absence ? await transaction.findPerson(absence.userId) : null;

    if (!absence || !attendant || !canRegisterFor(actor, { ...attendant, isActive: true })) {
      throw new NotFoundError();
    }
    if (!canCancelAbsence(absence, await transaction.today())) {
      throw new ConflictError();
    }

    await transaction.cancel(id);
  });
}
