import { handOverOnAbsence } from "./distribute";
import type { RequestTransactionRunner } from "./ports";

// The daily job hands an absent attendant's requests to colleagues (SPEC 2026-11-07-operacao-e-automacao,
// 4.3 item 7): on the first run of the absence, for sectors that chose it, once per absence. Each
// request is handed over in its own transaction, by the sector's mode; without anyone available it
// stays with the absent attendant.

export interface DueAbsence {
  absenceId: string;
  userId: string;
  sectorId: string;
}

export interface AbsenceHandoverStore {
  /** Absences in force today, not handed over yet, of attendants whose sector hands over on absence. */
  dueAbsences(): Promise<DueAbsence[]>;
  /** Open and in-progress requests the attendant holds in that sector. */
  heldRequests(userId: string, sectorId: string): Promise<Array<{ id: string; status: "OPEN" | "IN_PROGRESS" }>>;
  /** Marks the absence as handed over; false when another run did it first. */
  markHandedOver(absenceId: string): Promise<boolean>;
  transactions: RequestTransactionRunner;
}

export interface AbsenceHandoverSummary {
  absences: number;
  handedOver: number;
  kept: number;
}

export async function handOverAbsentAttendants(store: AbsenceHandoverStore): Promise<AbsenceHandoverSummary> {
  const summary: AbsenceHandoverSummary = { absences: 0, handedOver: 0, kept: 0 };

  for (const absence of await store.dueAbsences()) {
    // Marked first: two runs at once hand over each absence once.
    if (!(await store.markHandedOver(absence.absenceId))) continue;
    summary.absences += 1;

    for (const request of await store.heldRequests(absence.userId, absence.sectorId)) {
      const receiver = await store.transactions.run(async (transaction) =>
        handOverOnAbsence(transaction, {
          requestId: request.id,
          sectorId: absence.sectorId,
          status: request.status,
          fromAssigneeId: absence.userId,
          occurredAt: await transaction.currentTime(),
        }),
      );
      if (receiver) summary.handedOver += 1;
      else summary.kept += 1;
    }
  }

  return summary;
}
