import {
  assertCatalogSector,
  requireCatalogEditor,
  requirePublishedCatalogReader,
  type CatalogEditor,
} from "@/server/authorization";
import { ConflictError, NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { nextPosition, planPositionMove } from "@/shared/ordering";
import { entityIdSchema } from "@/shared/validation";
import { serviceFieldInputSchema, serviceFieldMoveSchema } from "./service-field-schemas";
import {
  assertCanAddActiveField,
  assertCanDeactivateController,
  assertConditionControllerActive,
  assertConditionTarget,
  assertFieldTypeUnchanged,
  assertNotControllerOfActiveFields,
  assertOptionsKeepConditions,
  type ConditionController,
  type ServiceFieldAudience,
  type ServiceFieldRecord,
} from "../domain/service-field";
import type {
  ServiceFieldRepository,
  ServiceFieldSummary,
  ServiceFieldTransaction,
  ServiceFieldTransactionRunner,
} from "./ports";

// Administrative configuration of custom fields (SPEC 2026-11-01-campos-personalizados, 5.1).
// Fields are deactivated, never deleted, and can be reactivated. Changes affect future requests
// only: answers keep their own snapshots.

export async function listServiceFields(repository: ServiceFieldRepository): Promise<ServiceFieldRecord[]> {
  const editor = await requireCatalogEditor();

  return editor.sectorId === null ? repository.listAll() : repository.listForSector(editor.sectorId);
}

// What the requester sees before opening a request (section 5.3.1). Callers load the published
// service first; the opening itself reloads the fields on the server.
export async function listPublishedServiceFields(
  serviceId: unknown,
  repository: ServiceFieldRepository,
): Promise<ServiceFieldRecord[]> {
  await requirePublishedCatalogReader();
  const id = validateInput(entityIdSchema, serviceId);

  // Attendance fields are not in the requester's form (SPEC 2026-11-03-campos-condicionais-atendimento, 5.4.2).
  return (await repository.listActiveForService(id)).filter((field) => field.audience === "REQUESTER");
}

export async function createServiceField(
  serviceId: unknown,
  input: unknown,
  transactions: ServiceFieldTransactionRunner,
): Promise<ServiceFieldRecord> {
  const editor = await requireCatalogEditor();
  const id = validateInput(entityIdSchema, serviceId);
  const parsed = validateInput(serviceFieldInputSchema, input);

  return transactions.run(async (transaction) => {
    const sectorId = await transaction.findServiceSector(id);

    if (sectorId === null) {
      throw new NotFoundError();
    }

    assertCatalogSector(editor, sectorId);

    const existing = await transaction.listForService(id);
    const active = existing.filter((field) => field.isActive);
    assertCanAddActiveField(active.length);
    assertLabelAvailable(active, parsed.label);
    const { audience = "REQUESTER", conditionFieldId = null, conditionValue = null, ...definition } = parsed;
    checkCondition({ id: null, audience }, conditionFieldId, conditionValue, existing);

    return transaction.audited({ actor: editor.actor, action: "CREATED", entityType: "SERVICE_FIELD" }, () =>
      transaction.create({
        serviceId: id,
        ...definition,
        audience,
        conditionFieldId,
        conditionValue: conditionFieldId === null ? null : conditionValue,
        position: nextPosition(existing),
      }),
    );
  });
}

export async function updateServiceField(
  fieldId: unknown,
  input: unknown,
  transactions: ServiceFieldTransactionRunner,
): Promise<ServiceFieldRecord> {
  const editor = await requireCatalogEditor();
  const id = validateInput(entityIdSchema, fieldId);
  const { type, ...changes } = validateInput(serviceFieldInputSchema, input);

  return transactions.run(async (transaction) => {
    const current = await loadField(transaction, id, editor);

    // Inactive fields are only reactivated, never edited.
    if (!current.isActive) {
      throw new ConflictError();
    }

    assertFieldTypeUnchanged(current.type, type);
    const existing = await transaction.listForService(current.serviceId);
    const others = existing.filter((field) => field.isActive && field.id !== id);
    assertLabelAvailable(others, changes.label);

    // SPEC 2026-11-03-campos-condicionais-atendimento, 5.2 and 5.3: omitted values stay as they are.
    const { audience = current.audience, conditionFieldId: requestedController, conditionValue: requestedValue, ...definition } = changes;
    const conditionFieldId = requestedController === undefined ? current.conditionFieldId : requestedController;
    const conditionValue = requestedController === undefined ? current.conditionValue : (requestedValue ?? null);
    const dependents = others.filter((field) => field.conditionFieldId === id);
    // SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.7 and 5.3.3 (decision G18): the service's
    // approval condition and the stages' conditions count as more dependents, which must stay
    // requester fields.
    const outsideValues = await conditionValuesOutsideFields(transaction, id);
    assertNotControllerOfActiveFields(dependents.length + outsideValues.length, conditionFieldId);
    // Dependents share the controller's audience (5.2.2), so it does not change under them.
    if (audience !== current.audience && (dependents.length > 0 || outsideValues.length > 0)) {
      throw new ConflictError();
    }
    assertOptionsKeepConditions(current.type, definition.options, [
      ...dependents.map((field) => field.conditionValue ?? ""),
      ...outsideValues,
    ]);
    checkCondition({ id, audience }, conditionFieldId, conditionValue, existing);

    return transaction.audited({ actor: editor.actor, action: "UPDATED", entityType: "SERVICE_FIELD", entityId: id }, () =>
      transaction.update(id, {
        ...definition,
        audience,
        conditionFieldId,
        conditionValue: conditionFieldId === null ? null : conditionValue,
      }),
    );
  });
}

export async function moveServiceField(
  fieldId: unknown,
  direction: unknown,
  transactions: ServiceFieldTransactionRunner,
): Promise<void> {
  const editor = await requireCatalogEditor();
  const id = validateInput(entityIdSchema, fieldId);
  const move = validateInput(serviceFieldMoveSchema, direction);

  await transactions.run(async (transaction) => {
    const current = await loadField(transaction, id, editor);

    if (!current.isActive) {
      throw new ConflictError();
    }

    const active = (await transaction.listForService(current.serviceId)).filter((field) => field.isActive);

    // One entry for the moved field; the neighbours only make room for it.
    await transaction.audited({ actor: editor.actor, action: "REORDERED", entityType: "SERVICE_FIELD", entityId: id }, async () => {
      for (const update of planPositionMove(active, id, move)) {
        await transaction.update(update.id, { position: update.position });
      }
      return { id };
    });
  });
}

export async function deactivateServiceField(
  fieldId: unknown,
  transactions: ServiceFieldTransactionRunner,
): Promise<ServiceFieldRecord> {
  const editor = await requireCatalogEditor();
  const id = validateInput(entityIdSchema, fieldId);

  return transactions.run(async (transaction) => {
    const current = await loadField(transaction, id, editor);

    if (current.isActive) {
      // SPEC 2026-11-03-campos-condicionais-atendimento, 5.3.1.
      const existing = await transaction.listForService(current.serviceId);
      // The approval and stage conditions also keep their field active (SPEC
      // 2026-11-06-aprofundamento-configurabilidade, 4.3.7 and 5.3.3).
      const outsideValues = await conditionValuesOutsideFields(transaction, id);
      assertCanDeactivateController(
        existing.filter((field) => field.isActive && field.conditionFieldId === id).length + outsideValues.length,
      );
    }

    return current.isActive
      ? transaction.audited({ actor: editor.actor, action: "DEACTIVATED", entityType: "SERVICE_FIELD", entityId: id }, () =>
          transaction.update(id, { isActive: false }),
        )
      : current;
  });
}

// A reactivated field goes to the end of the form, within the limit and without repeating the
// label of another active field (section 5.1 item 4).
export async function reactivateServiceField(
  fieldId: unknown,
  transactions: ServiceFieldTransactionRunner,
): Promise<ServiceFieldRecord> {
  const editor = await requireCatalogEditor();
  const id = validateInput(entityIdSchema, fieldId);

  return transactions.run(async (transaction) => {
    const current = await loadField(transaction, id, editor);

    if (current.isActive) {
      return current;
    }

    const existing = await transaction.listForService(current.serviceId);
    const active = existing.filter((field) => field.isActive);
    assertCanAddActiveField(active.length);
    assertLabelAvailable(active, current.label);
    // SPEC 2026-11-03-campos-condicionais-atendimento, 5.3.3.
    assertConditionControllerActive(
      existing.find((field) => field.id === current.conditionFieldId) ?? null,
      current.conditionFieldId,
    );

    return transaction.audited({ actor: editor.actor, action: "REACTIVATED", entityType: "SERVICE_FIELD", entityId: id }, () =>
      transaction.update(id, { isActive: true, position: nextPosition(existing) }),
    );
  });
}

/**
 * Values of the conditions outside the fields that use this field: the service's approval condition
 * and the active stages' conditions (SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.7 and 5.3.3).
 */
async function conditionValuesOutsideFields(transaction: ServiceFieldTransaction, fieldId: string): Promise<string[]> {
  const approvalValue = (await transaction.findApprovalConditionValue?.(fieldId)) ?? null;
  const stageValues = (await transaction.findStageConditionValues?.(fieldId)) ?? [];
  return [...(approvalValue === null ? [] : [approvalValue]), ...stageValues];
}

/** Section 5.2 of SPEC 2026-11-03-campos-condicionais-atendimento, against the fields of the same service. */
function checkCondition(
  field: { id: string | null; audience: ServiceFieldAudience },
  conditionFieldId: string | null,
  conditionValue: string | null,
  serviceFields: readonly ServiceFieldSummary[],
): void {
  if (conditionFieldId === null) {
    return;
  }

  const found = serviceFields.find((item) => item.id === conditionFieldId);
  const controller: ConditionController | null = found
    ? {
        id: found.id,
        type: found.type ?? "SHORT_TEXT",
        options: found.options ?? [],
        audience: found.audience ?? "REQUESTER",
        isActive: found.isActive,
        conditionFieldId: found.conditionFieldId ?? null,
      }
    : null;
  assertConditionTarget(field, controller, conditionValue ?? "");
}

// Labels are unique among the active fields of a service, ignoring case; the database
// enforces the same rule with a partial unique index on a citext column.
function assertLabelAvailable(activeFields: ReadonlyArray<{ label: string }>, label: string): void {
  const wanted = label.toLowerCase();

  if (activeFields.some((field) => field.label.toLowerCase() === wanted)) {
    throw new ConflictError();
  }
}

async function loadField(
  transaction: ServiceFieldTransaction,
  id: string,
  editor: CatalogEditor,
): Promise<ServiceFieldRecord> {
  const field = await transaction.find(id);

  if (!field) {
    throw new NotFoundError();
  }

  // SPEC 2026-11-01-permissoes-configuraveis, 5.3.1: only the editor's sector.
  assertCatalogSector(editor, (await transaction.findServiceSector(field.serviceId)) ?? "");

  return field;
}
