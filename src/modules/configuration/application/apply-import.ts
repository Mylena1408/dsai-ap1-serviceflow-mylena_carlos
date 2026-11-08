import { createHash } from "node:crypto";
import { z } from "zod";
import type { AuditActor } from "@/modules/audit";
import { requireConfigurationAdministrator } from "@/server/authorization";
import { ConflictError, ValidationError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import type { ConfigurationData } from "../domain/format";
import type { DestinationPerson, ItemStatus, PreviewItem } from "../domain/preview";
import { evaluateImport, type ConfigurationImportStore } from "./preview-import";

// Applying an import (SPEC 2026-11-07-operacao-e-automacao, 6.3 items 5 and 6; decisions H12 and H15):
// only after the preview, confirming the same file (its digest) against the same destination (the
// destination's digest, read again in the transaction); otherwise it is refused and asks for a new preview.
// All or nothing in one transaction; nothing is deleted; what the file does not have stays as it is. Each
// item created or changed enters the audit trail as if done on its screen, and the import has its own entry
// with the summary.

export interface ImportPlan {
  /** The file's data without the people who stay out. */
  data: ConfigurationData;
  items: readonly PreviewItem[];
  people: ReadonlyMap<string, DestinationPerson>;
}

export interface ConfigurationApplyTransaction extends ConfigurationImportStore {
  write(plan: ImportPlan, actor: AuditActor): Promise<void>;
  recordImport(actor: AuditActor, summary: Record<ItemStatus, number>): Promise<void>;
}

export interface ConfigurationApplyStore {
  run<T>(work: (transaction: ConfigurationApplyTransaction) => Promise<T>): Promise<T>;
}

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const importConfirmationSchema = z
  .object({
    content: z.string(),
    /** What the preview returned. */
    digest: digestSchema,
    destinationDigest: digestSchema,
  })
  .strict();

export async function applyConfigurationImport(input: unknown, store: ConfigurationApplyStore): Promise<Record<ItemStatus, number>> {
  const actor = await requireConfigurationAdministrator();
  const confirmation = validateInput(importConfirmationSchema, input);

  // Not the file that was previewed.
  if (createHash("sha256").update(confirmation.content, "utf8").digest("hex") !== confirmation.digest) {
    throw new ConflictError();
  }

  return store.run(async (transaction) => {
    const evaluation = await evaluateImport(confirmation.content, transaction);
    // The destination changed after the preview: a new preview is needed.
    if (evaluation.destinationDigest !== confirmation.destinationDigest) {
      throw new ConflictError();
    }
    if (!evaluation.accepted || evaluation.effective === null) {
      throw new ValidationError([{ path: [], code: "invalid_value" }]);
    }
    await transaction.write({ data: evaluation.effective, items: evaluation.items, people: evaluation.people }, actor);
    await transaction.recordImport(actor, evaluation.summary);
    return evaluation.summary;
  });
}
