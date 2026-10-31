import { requireStatusChangeActor } from "@/server/authorization";
import { ConflictError, NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import {
  assertCanAssume,
  assertCanRelease,
  assertCanTransfer,
  type LifecycleRequest,
  type LifecycleUser,
} from "../domain/lifecycle";
import { requestAssignmentInputSchema, requestTransferInputSchema } from "./request-schemas";
import type { RequestTransaction, RequestTransactionRunner } from "./ports";

// Assume, release and transfer within the request's sector (SPEC 2026-10-31, section 5.2).
// The session check rejects anyone who is not an attendant of the request's sector; the
// transaction reloads actor and request so every rule runs on current database state.

type AssignmentDecision = (
  actor: LifecycleUser,
  request: LifecycleRequest,
  transaction: RequestTransaction,
) => Promise<string | null>;

async function changeAssignee(
  requestId: string,
  transactions: RequestTransactionRunner,
  decide: AssignmentDecision,
): Promise<void> {
  const authorized = await requireStatusChangeActor(requestId);

  await transactions.run(async (transaction) => {
    const actor = await transaction.findActor(authorized.actorId);
    const request = await transaction.findLifecycleState(requestId);

    if (!actor || !request) {
      throw new NotFoundError();
    }

    const toAssigneeId = await decide(actor, request, transaction);
    const fromAssigneeId = request.assignee?.id ?? null;
    const occurredAt = await transaction.currentTime();
    const changed = await transaction.updateAssigneeIfCurrent({
      requestId,
      expectedStatus: request.status,
      expectedAssigneeId: fromAssigneeId,
      assigneeId: toAssigneeId,
      updatedAt: occurredAt,
    });

    // Someone else changed status or assignee after the read (section 5.8).
    if (changed !== 1) {
      throw new ConflictError();
    }

    await transaction.insertAssignmentEvent({
      requestId,
      actorId: actor.id,
      fromAssigneeId,
      toAssigneeId,
      occurredAt,
    });
  });
}

/** Section 5.2: the actor becomes the assignee. */
export async function assumeRequest(
  input: unknown,
  transactions: RequestTransactionRunner,
): Promise<void> {
  const { requestId } = validateInput(requestAssignmentInputSchema, input);

  await changeAssignee(requestId, transactions, async (actor, request) => {
    assertCanAssume(actor, request);
    return actor.id;
  });
}

/** Section 5.2: the effective assignee leaves the request without assignee. */
export async function releaseRequest(
  input: unknown,
  transactions: RequestTransactionRunner,
): Promise<void> {
  const { requestId } = validateInput(requestAssignmentInputSchema, input);

  await changeAssignee(requestId, transactions, async (actor, request) => {
    assertCanRelease(actor, request);
    return null;
  });
}

/**
 * Section 5.2 (decision D1): the effective assignee hands the request to another active
 * attendant of the same sector. The target comes from the form but is checked here.
 */
export async function transferRequest(
  input: unknown,
  transactions: RequestTransactionRunner,
): Promise<void> {
  const { requestId, assigneeId } = validateInput(requestTransferInputSchema, input);

  await changeAssignee(requestId, transactions, async (actor, request, transaction) => {
    const target = await transaction.findUserForAssignment(assigneeId);
    assertCanTransfer(actor, request, target);
    return assigneeId;
  });
}
