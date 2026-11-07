import { z } from "zod";
import { entityIdSchema } from "@/shared/validation";
import type { RequestStatus } from "./request";

// The requests of one bundle opening (SPEC 2026-11-07-operacao-e-automacao, 3.3 item 4): the group is
// "em andamento" while any request is open or in progress (approval pending included) and
// "encerrado" when every one is completed or cancelled.

export interface GroupMember {
  status: RequestStatus;
}

export interface GroupProgress {
  total: number;
  completed: number;
  cancelled: number;
  closed: boolean;
}

export function groupProgress(members: readonly GroupMember[]): GroupProgress {
  const completed = members.filter(({ status }) => status === "COMPLETED").length;
  const cancelled = members.filter(({ status }) => status === "CANCELLED").length;
  return { total: members.length, completed, cancelled, closed: completed + cancelled === members.length };
}

/** "2 de 3 concluídas" (with the cancelled ones apart: "· 1 cancelada"). */
export function groupProgressText(progress: GroupProgress): string {
  const base = `${progress.completed} de ${progress.total} ${progress.completed === 1 ? "concluída" : "concluídas"}`;
  if (progress.cancelled === 0) return base;
  return `${base} · ${progress.cancelled} ${progress.cancelled === 1 ? "cancelada" : "canceladas"}`;
}

export function groupStateLabel(progress: GroupProgress): string {
  return progress.closed ? "Encerrado" : "Em andamento";
}

export const groupCancellationSchema = z
  .object({
    groupId: entityIdSchema,
    // Optional for the requester, as when cancelling one request (SPEC 2026-10-31, 5.4).
    note: z
      .union([z.string(), z.null()])
      .optional()
      .transform((value) => (value === undefined || value === null || value.trim() === "" ? null : value.trim())),
  })
  .strict();

/** Why a request of the group was not cancelled with the bundle. */
export type GroupKeptReason = "not_open" | "changed";

export interface GroupCancellation {
  cancelled: string[];
  kept: Array<{ requestId: string; reason: GroupKeptReason }>;
}
