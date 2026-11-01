import { requireConfigurationAdministrator } from "@/server/authorization";
import { ConflictError, NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { nextPosition, planPositionMove } from "@/shared/ordering";
import { entityIdSchema } from "@/shared/validation";
import { serviceFieldInputSchema, serviceFieldMoveSchema } from "./service-field-schemas";
import {
  assertCanAddActiveField,
  assertFieldTypeUnchanged,
  type ServiceFieldRecord,
} from "../domain/service-field";
import type { ServiceFieldRepository, ServiceFieldTransaction, ServiceFieldTransactionRunner } from "./ports";

// Administrative configuration of custom fields (SPEC 2026-11-01-campos-personalizados, 5.1).
// Fields are deactivated, never deleted, and can be reactivated. Changes affect future requests
// only: answers keep their own snapshots.

export async function listServiceFields(repository: ServiceFieldRepository): Promise<ServiceFieldRecord[]> {
  await requireConfigurationAdministrator();

  return repository.listAll();
}

export async function createServiceField(
  serviceId: unknown,
  input: unknown,
  transactions: ServiceFieldTransactionRunner,
): Promise<ServiceFieldRecord> {
  await requireConfigurationAdministrator();
  const id = validateInput(entityIdSchema, serviceId);
  const parsed = validateInput(serviceFieldInputSchema, input);

  return transactions.run(async (transaction) => {
    if (!(await transaction.serviceExists(id))) {
      throw new NotFoundError();
    }

    const existing = await transaction.listForService(id);
    const active = existing.filter((field) => field.isActive);
    assertCanAddActiveField(active.length);
    assertLabelAvailable(active, parsed.label);

    return transaction.create({ serviceId: id, ...parsed, position: nextPosition(existing) });
  });
}

export async function updateServiceField(
  fieldId: unknown,
  input: unknown,
  transactions: ServiceFieldTransactionRunner,
): Promise<ServiceFieldRecord> {
  await requireConfigurationAdministrator();
  const id = validateInput(entityIdSchema, fieldId);
  const { type, ...changes } = validateInput(serviceFieldInputSchema, input);

  return transactions.run(async (transaction) => {
    const current = await loadField(transaction, id);

    // Inactive fields are only reactivated, never edited.
    if (!current.isActive) {
      throw new ConflictError();
    }

    assertFieldTypeUnchanged(current.type, type);
    const others = (await transaction.listForService(current.serviceId)).filter(
      (field) => field.isActive && field.id !== id,
    );
    assertLabelAvailable(others, changes.label);

    return transaction.update(id, changes);
  });
}

export async function moveServiceField(
  fieldId: unknown,
  direction: unknown,
  transactions: ServiceFieldTransactionRunner,
): Promise<void> {
  await requireConfigurationAdministrator();
  const id = validateInput(entityIdSchema, fieldId);
  const move = validateInput(serviceFieldMoveSchema, direction);

  await transactions.run(async (transaction) => {
    const current = await loadField(transaction, id);

    if (!current.isActive) {
      throw new ConflictError();
    }

    const active = (await transaction.listForService(current.serviceId)).filter((field) => field.isActive);

    for (const update of planPositionMove(active, id, move)) {
      await transaction.update(update.id, { position: update.position });
    }
  });
}

export async function deactivateServiceField(
  fieldId: unknown,
  transactions: ServiceFieldTransactionRunner,
): Promise<ServiceFieldRecord> {
  await requireConfigurationAdministrator();
  const id = validateInput(entityIdSchema, fieldId);

  return transactions.run(async (transaction) => {
    const current = await loadField(transaction, id);

    return current.isActive ? transaction.update(id, { isActive: false }) : current;
  });
}

// A reactivated field goes to the end of the form, within the limit and without repeating the
// label of another active field (section 5.1 item 4).
export async function reactivateServiceField(
  fieldId: unknown,
  transactions: ServiceFieldTransactionRunner,
): Promise<ServiceFieldRecord> {
  await requireConfigurationAdministrator();
  const id = validateInput(entityIdSchema, fieldId);

  return transactions.run(async (transaction) => {
    const current = await loadField(transaction, id);

    if (current.isActive) {
      return current;
    }

    const existing = await transaction.listForService(current.serviceId);
    const active = existing.filter((field) => field.isActive);
    assertCanAddActiveField(active.length);
    assertLabelAvailable(active, current.label);

    return transaction.update(id, { isActive: true, position: nextPosition(existing) });
  });
}

// Labels are unique among the active fields of a service, ignoring case; the database
// enforces the same rule with a partial unique index on a citext column.
function assertLabelAvailable(activeFields: ReadonlyArray<{ label: string }>, label: string): void {
  const wanted = label.toLowerCase();

  if (activeFields.some((field) => field.label.toLowerCase() === wanted)) {
    throw new ConflictError();
  }
}

async function loadField(transaction: ServiceFieldTransaction, id: string): Promise<ServiceFieldRecord> {
  const field = await transaction.find(id);

  if (!field) {
    throw new NotFoundError();
  }

  return field;
}
