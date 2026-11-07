import { randomUUID } from "node:crypto";
import { collectFieldAnswers, FieldAnswersError, type FieldAnswerError } from "@/modules/service-fields";
import { requireRequestCreator } from "@/server/authorization";
import { ConflictError, NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { answersOf, bundleOpeningInputSchema, strayAnswers } from "../domain/bundle-opening";
import { loadOpeningContext, openRequest } from "./create-request";
import type { RequestTransactionRunner } from "./ports";

// Opening a bundle (SPEC 2026-11-07-operacao-e-automacao, 3.3 item 3): all or nothing, in one
// transaction. Every service is checked first (available, without documents, answers valid), with
// the field errors of every section together; then the group and one request per service are
// created, each exactly as an opening of that service alone.

export interface BundleOpening {
  groupId: string;
  requestIds: string[];
}

export async function openBundle(input: unknown, transactions: RequestTransactionRunner): Promise<BundleOpening> {
  const actor = await requireRequestCreator();
  const parsed = validateInput(bundleOpeningInputSchema, input);
  const groupId = randomUUID();

  const requestIds = await transactions.run(async (transaction) => {
    const bundle = await transaction.findBundleForOpening(parsed.bundleId);
    if (!bundle || !bundle.isActive) {
      throw new NotFoundError();
    }

    // 1. Every service can be opened now, without documents (decision H5).
    const sections = [];
    for (const serviceId of bundle.serviceIds) {
      await loadOpeningContext(transaction, actor.id, serviceId);
      if ((await transaction.listActiveRequirements(serviceId)).length > 0) {
        throw new ConflictError();
      }
      const fields = await transaction.listActiveFields(serviceId);
      sections.push({ serviceId, fields, fieldIds: new Set(fields.map(({ id }) => id)) });
    }

    // 2. The answers of every section, with all the field errors together.
    const values = parsed.fieldValues ?? {};
    if (strayAnswers(values, new Set(sections.flatMap(({ fieldIds }) => [...fieldIds]))).length > 0) {
      throw new FieldAnswersError("stale_form");
    }
    const errors: FieldAnswerError[] = [];
    for (const section of sections) {
      const result = collectFieldAnswers(section.fields, new Map(Object.entries(answersOf(values, section.fieldIds))));
      if (!result.ok && result.reason === "stale_form") throw new FieldAnswersError("stale_form");
      if (!result.ok) errors.push(...result.errors);
    }
    if (errors.length > 0) {
      throw new FieldAnswersError("invalid", errors);
    }

    // 3. The group and one request per service, in the bundle's order.
    await transaction.insertRequestGroup({
      id: groupId,
      bundleId: bundle.id,
      bundleNameSnapshot: bundle.name,
      requesterId: actor.id,
      createdAt: await transaction.currentTime(),
    });
    const ids: string[] = [];
    for (const section of sections) {
      const requestId = randomUUID();
      const fieldValues = answersOf(values, section.fieldIds);
      await openRequest(
        transaction,
        actor.id,
        { serviceId: section.serviceId, description: parsed.description, ...(Object.keys(fieldValues).length > 0 ? { fieldValues } : {}) },
        requestId,
        [],
        groupId,
      );
      ids.push(requestId);
    }
    return ids;
  });

  return { groupId, requestIds };
}
