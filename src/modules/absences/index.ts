import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import * as useCases from "./application/absences";
import { createPrismaAbsenceStore } from "./infrastructure/prisma-absences";

// Managers' absences with a substitute (SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.5).
export { MAX_ABSENCE_DAYS, absenceDays, absenceInForce, canCancelAbsence } from "./domain/absence";
export type { AbsenceRecord } from "./domain/absence";

const store = (database: PrismaClient) => createPrismaAbsenceStore(database);

export function listAbsences(database: PrismaClient = prisma) {
  return useCases.listAbsences(store(database));
}

export function listSubstituteCandidates(database: PrismaClient = prisma) {
  return useCases.listSubstituteCandidates(store(database));
}

export function registerAbsence(input: unknown, database: PrismaClient = prisma) {
  return useCases.registerAbsence(input, store(database));
}

export function cancelAbsence(absenceId: unknown, database: PrismaClient = prisma) {
  return useCases.cancelAbsence(absenceId, store(database));
}
