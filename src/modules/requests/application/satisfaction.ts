import { z } from "zod";
import { requireCurrentActor } from "@/server/authorization";
import { NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";
import {
  MAX_SATISFACTION_COMMENT_LENGTH,
  assertCanRate,
  normalizeSatisfactionComment,
  replacesEarlierRating,
  satisfactionAvailability,
  satisfactionDeadline,
  type SatisfactionActor,
  type SatisfactionAvailability,
  type SatisfactionTarget,
} from "../domain/satisfaction";
import { authorizeRequestRead } from "./attachment-queries";
import type { AttachmentQueryRepository } from "./ports";

// Satisfaction survey (SPEC 2026-11-06-pesquisa-satisfacao). Writing follows the rules of the
// domain inside one serializable transaction; reading follows the read rule of the request.

export interface SatisfactionRecord {
  rating: number;
  comment: string | null;
  ratedAt: Date;
  completedAtSnapshot: Date;
}

export interface SatisfactionHistoryEntry {
  rating: number;
  replaced: boolean;
  occurredAt: Date;
  actorName: string;
}

export interface SatisfactionTransaction {
  findActor(actorId: string): Promise<SatisfactionActor | null>;
  findTarget(requestId: string): Promise<SatisfactionTarget | null>;
  currentTime(): Promise<Date>;
  save(input: {
    requestId: string;
    requesterId: string;
    rating: number;
    comment: string | null;
    completedAtSnapshot: Date;
    ratedAt: Date;
    replaced: boolean;
  }): Promise<void>;
}

export interface SatisfactionStore {
  run<T>(work: (transaction: SatisfactionTransaction) => Promise<T>): Promise<T>;
  find(requestId: string): Promise<SatisfactionRecord | null>;
  history(requestId: string): Promise<SatisfactionHistoryEntry[]>;
  findTarget(requestId: string): Promise<SatisfactionTarget | null>;
}

export const satisfactionInputSchema = z
  .object({
    requestId: entityIdSchema,
    rating: z.coerce.number().int().min(1).max(5),
    comment: z.string().max(MAX_SATISFACTION_COMMENT_LENGTH).nullish(),
  })
  .strict();

/** The owner rates the request (4.1 to 4.4). */
export async function rateRequest(input: unknown, store: SatisfactionStore): Promise<void> {
  const session = await requireCurrentActor();
  const parsed = validateInput(satisfactionInputSchema, input);
  const comment = normalizeSatisfactionComment(parsed.comment);

  await store.run(async (transaction) => {
    const actor = await transaction.findActor(session.id);
    const target = await transaction.findTarget(parsed.requestId);
    if (!actor || !target) throw new NotFoundError();

    const now = await transaction.currentTime();
    assertCanRate(actor, target, now);
    await transaction.save({
      requestId: parsed.requestId,
      requesterId: actor.id,
      rating: parsed.rating,
      comment,
      completedAtSnapshot: target.completedAt!,
      ratedAt: now,
      replaced: replacesEarlierRating(target),
    });
  });
}

export interface RequestSatisfactionView {
  /** The rating of the current completion, or of an earlier one before a new rating. */
  current: SatisfactionRecord | null;
  history: SatisfactionHistoryEntry[];
  /** Only meaningful to the owner: what the form shows (4.3). */
  availability: SatisfactionAvailability;
  deadline: Date | null;
}

/**
 * What the readers of the request see (4.6): the owner, the sector's team and a manager who reads
 * the request. Anyone else gets "not found".
 */
export async function getRequestSatisfaction(
  requestId: unknown,
  scope: Pick<AttachmentQueryRepository, "findRequestScope">,
  store: SatisfactionStore,
  now: Date,
): Promise<RequestSatisfactionView> {
  const id = await authorizeRequestRead(requestId, scope);
  const [current, history, target] = await Promise.all([store.find(id), store.history(id), store.findTarget(id)]);
  if (!target) throw new NotFoundError();

  return {
    current,
    history,
    availability: satisfactionAvailability(target, now),
    deadline: target.completedAt ? satisfactionDeadline(target.completedAt) : null,
  };
}
