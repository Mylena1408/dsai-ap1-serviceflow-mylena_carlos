import { z } from "zod";
import {
  collectFieldAnswers,
  FieldAnswersError,
  missingRequiredFields,
  multipleChoiceOptions,
  type AnswerableField,
  type FieldAnswer,
} from "@/modules/service-fields";
import { requireStatusChangeActor } from "@/server/authorization";
import { ConflictError, NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";
import { effectiveAssigneeId, type LifecycleRequest, type LifecycleUser } from "../domain/lifecycle";
import { supervises } from "./assignment";
import type { RequestTransaction, RequestTransactionRunner } from "./ports";

// Fields filled by the attendance (SPEC 2026-11-03-campos-condicionais-atendimento, 5.5): saved and
// changed while the request is open or in progress; required ones are checked at the completion.

const saveInputSchema = z
  .object({
    requestId: entityIdSchema,
    values: z
      .record(z.string().max(64), z.union([z.string().max(20_000), z.array(z.string().max(200)).max(20)]))
      .refine((values) => Object.keys(values).length <= 50, { message: "Too many field values." }),
  })
  .strict();

/** The completion is refused while a required attendance field is missing (5.5.4). */
export class AttendanceFieldsMissingError extends ConflictError {
  constructor(readonly labels: readonly string[]) {
    super();
  }
}

/**
 * Who fills the attendance fields (5.4.2), the same people who change the priority: the effective
 * assignee, any attendant of the sector when nobody holds it, or a queue supervisor; while open
 * or in progress. Outside the sector: 404; a colleague without the right or another status: 409.
 */
function assertCanFillAttendance(actor: LifecycleUser, request: LifecycleRequest, supervisor: boolean): void {
  if (!actor.isActive || actor.role !== "ATTENDANT" || actor.sectorId !== request.sectorId) {
    throw new NotFoundError();
  }

  const holderId = effectiveAssigneeId(request);

  if ((holderId !== null && holderId !== actor.id && !supervisor) || (request.status !== "OPEN" && request.status !== "IN_PROGRESS")) {
    throw new ConflictError();
  }
}

/** Saved answers as the condition rule reads them. */
async function currentAnswers(transaction: RequestTransaction, requestId: string) {
  const rows = await transaction.listAttendanceAnswers(requestId);
  return new Map(rows.map((row) => [row.fieldId, row]));
}

/**
 * Section 5.5 items 1 to 3 and 7: validates by type and condition (required ones are not demanded
 * here, only at the completion), writes what changed and records the changed labels.
 */
export async function saveAttendanceFields(input: unknown, transactions: RequestTransactionRunner): Promise<{ changed: string[] }> {
  const parsed = validateInput(saveInputSchema, input);
  const authorized = await requireStatusChangeActor(parsed.requestId);

  return transactions.run(async (transaction) => {
    const actor = await transaction.findActor(authorized.actorId);
    const request = await transaction.findLifecycleState(parsed.requestId);

    if (!actor || !request || !request.serviceId) {
      throw new NotFoundError();
    }

    assertCanFillAttendance(actor, request, await supervises(actor, request, transaction));

    const fields = await transaction.listActiveAttendanceFields(request.serviceId);
    const optional: AnswerableField[] = fields.map((field) => ({ ...field, isRequired: false }));
    const result = collectFieldAnswers(optional, new Map(Object.entries(parsed.values)));

    if (!result.ok) {
      throw result.reason === "stale_form" ? new FieldAnswersError("stale_form") : new FieldAnswersError("invalid", result.errors);
    }

    const saved = await currentAnswers(transaction, parsed.requestId);
    const next = new Map(result.answers.map((answer) => [answer.fieldId, answer]));
    const upserts: FieldAnswer[] = result.answers.filter((answer) => saved.get(answer.fieldId)?.value !== answer.value);
    const removals = [...saved.keys()].filter((fieldId) => !next.has(fieldId) && fields.some((field) => field.id === fieldId));

    if (upserts.length === 0 && removals.length === 0) {
      return { changed: [] };
    }

    const occurredAt = await transaction.currentTime();
    const touched = await transaction.touchRequestIfCurrent({
      requestId: parsed.requestId,
      expectedStatus: request.status,
      expectedAssigneeId: request.assignee?.id ?? null,
      updatedAt: occurredAt,
    });

    // Status or assignee changed after the read (5.5.7).
    if (touched !== 1) {
      throw new ConflictError();
    }

    await transaction.saveAttendanceAnswers({ requestId: parsed.requestId, actorId: actor.id, at: occurredAt, upserts, removals });
    const changedIds = new Set([...upserts.map(({ fieldId }) => fieldId), ...removals]);
    const changed = fields.filter((field) => changedIds.has(field.id)).map((field) => field.label);
    // Labels only, never the values (5.5.3).
    await transaction.insertFieldUpdateEvent({ requestId: parsed.requestId, actorId: actor.id, labels: changed, occurredAt });
    return { changed };
  });
}

/** Section 5.5.4: called by the completion, in its transaction. */
export async function assertAttendanceFieldsComplete(transaction: RequestTransaction, requestId: string, serviceId: string | undefined): Promise<void> {
  if (!serviceId) {
    return;
  }

  const fields = await transaction.listActiveAttendanceFields(serviceId);

  if (fields.length === 0) {
    return;
  }

  const missing = missingRequiredFields(fields, await currentAnswers(transaction, requestId));

  if (missing.length > 0) {
    throw new AttendanceFieldsMissingError(missing);
  }
}

export interface AttendanceFieldsView {
  fields: Array<AnswerableField & { helpText: string | null }>;
  /** Saved values by field id; a multiple choice has its list of options. */
  values: Record<string, string | string[]>;
}

/** The form of the queue (5.4.2): only attendants of the request's sector read it. */
export async function getAttendanceFields(requestId: unknown, transactions: RequestTransactionRunner): Promise<AttendanceFieldsView> {
  const id = validateInput(entityIdSchema, requestId);
  await requireStatusChangeActor(id);

  return transactions.run(async (transaction) => {
    const request = await transaction.findLifecycleState(id);

    if (!request?.serviceId) {
      throw new NotFoundError();
    }

    const fields = (await transaction.listActiveAttendanceFields(request.serviceId)).map((field) => ({ ...field, helpText: field.helpText ?? null }));
    const values: Record<string, string | string[]> = {};
    for (const answer of await transaction.listAttendanceAnswers(id)) {
      values[answer.fieldId] = answer.type === "MULTI_SELECT" ? multipleChoiceOptions(answer.value) : answer.value;
    }
    return { fields, values };
  });
}
