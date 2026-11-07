import { requireCurrentActor, type AuthorizationActor } from "@/server/authorization";
import { AuthorizationError, ConflictError, NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";
import {
  absenceInputSchema,
  assertAbsenceFits,
  assertAbsencePeriod,
  canCancelAbsence,
  type AbsencePeriod,
  type AbsenceRecord,
} from "../domain/absence";

// Use cases of the managers' absences (SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.5):
// a manager registers and cancels their own; the administrator does it for any manager. The
// substitute's powers come from the request module, which reads the absences in force.

export interface AbsenceUser {
  id: string;
  role: AuthorizationActor["role"];
  isActive: boolean;
}

export interface AbsenceTransaction {
  /** The organization's calendar day now (database clock, business calendar time zone). */
  today(): Promise<string>;
  findUser(userId: string): Promise<AbsenceUser | null>;
  /** Absences not cancelled of a manager, as absent and as substitute. */
  activePeriods(userId: string, as: "manager" | "substitute"): Promise<AbsencePeriod[]>;
  findAbsence(absenceId: string): Promise<{ id: string; managerId: string; endsOn: string; cancelledAt: Date | null } | null>;
  create(input: AbsencePeriod & { managerId: string; substituteId: string; createdById: string }): Promise<{ id: string }>;
  cancel(absenceId: string): Promise<void>;
}

export interface AbsenceStore {
  run<T>(work: (transaction: AbsenceTransaction) => Promise<T>): Promise<T>;
  /** Absences of one manager (as absent or as substitute), or every absence when null; recent first. */
  list(userId: string | null): Promise<AbsenceRecord[]>;
  /** Active managers other than one, by name, with their sector. */
  listSubstituteCandidates(exceptUserId: string | null): Promise<Array<{ id: string; name: string; sectorName: string | null }>>;
  today(): Promise<string>;
}

function absenceActor(actor: AuthorizationActor): AuthorizationActor {
  if (actor.role !== "MANAGER" && actor.role !== "ADMIN") {
    throw new AuthorizationError();
  }
  return actor;
}

export async function listAbsences(store: AbsenceStore): Promise<{ today: string; absences: AbsenceRecord[] }> {
  const actor = absenceActor(await requireCurrentActor());
  const [today, absences] = await Promise.all([store.today(), store.list(actor.role === "ADMIN" ? null : actor.id)]);
  return { today, absences };
}

export async function listSubstituteCandidates(store: AbsenceStore) {
  const actor = absenceActor(await requireCurrentActor());
  return store.listSubstituteCandidates(actor.role === "MANAGER" ? actor.id : null);
}

export async function registerAbsence(input: unknown, store: AbsenceStore): Promise<{ id: string }> {
  const actor = absenceActor(await requireCurrentActor());
  const parsed = validateInput(absenceInputSchema, input);
  // A manager only registers their own absence; the administrator names the manager.
  const managerId = actor.role === "MANAGER" ? actor.id : parsed.managerId;

  if (!managerId || (actor.role === "MANAGER" && parsed.managerId !== undefined && parsed.managerId !== actor.id)) {
    throw new NotFoundError();
  }

  const period = { startsOn: parsed.startsOn, endsOn: parsed.endsOn };

  return store.run(async (transaction) => {
    const [manager, substitute] = await Promise.all([transaction.findUser(managerId), transaction.findUser(parsed.substituteId)]);

    if (!manager || manager.role !== "MANAGER" || !manager.isActive) {
      throw new NotFoundError();
    }
    if (!substitute || substitute.role !== "MANAGER" || !substitute.isActive || substitute.id === manager.id) {
      throw new ConflictError();
    }

    assertAbsencePeriod(period, await transaction.today());
    assertAbsenceFits(
      period,
      await transaction.activePeriods(manager.id, "manager"),
      await transaction.activePeriods(substitute.id, "manager"),
    );

    return transaction.create({ ...period, managerId: manager.id, substituteId: substitute.id, createdById: actor.id });
  });
}

export async function cancelAbsence(absenceId: unknown, store: AbsenceStore): Promise<void> {
  const actor = absenceActor(await requireCurrentActor());
  const id = validateInput(entityIdSchema, absenceId);

  await store.run(async (transaction) => {
    const absence = await transaction.findAbsence(id);

    if (!absence || (actor.role === "MANAGER" && absence.managerId !== actor.id)) {
      throw new NotFoundError();
    }
    if (!canCancelAbsence(absence, await transaction.today())) {
      throw new ConflictError();
    }

    await transaction.cancel(id);
  });
}
