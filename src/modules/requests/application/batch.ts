import { z } from "zod";
import { assertRole, requireCurrentActor } from "@/server/authorization";
import { ApplicationError, ValidationError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";
import { sectorTransferNote } from "../domain/lifecycle";
import type { RequestQueryRepository } from "./ports";

// Batch actions in the queue (SPEC 2026-11-07-operacao-e-automacao, 7.3 item 2; decisions H17 and H18): the
// attendant applies one action to up to 50 requests of the page: assume, transfer to a colleague, change the
// priority or send to another sector. Each item goes through the individual action itself, with exactly its
// rules, history, events and warnings, in its own transaction; a refused item does not undo the others. The
// result says, per item, done or refused with a fixed reason.

export const MAX_BATCH_ITEMS = 50;

// "tag" and "untag": SPEC 2026-11-08-atendimento-dia-a-dia, 3.3 item 5 (decision I21); "duplicate": 13.5 item 2
// (decision J10).
export const BATCH_ACTIONS = ["assume", "transfer", "priority", "sector", "tag", "untag", "duplicate"] as const;
export type BatchAction = (typeof BATCH_ACTIONS)[number];

const requestIds = z
  .array(entityIdSchema)
  .min(1)
  .max(MAX_BATCH_ITEMS)
  .refine((ids) => new Set(ids).size === ids.length);

export const batchInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assume"), requestIds }).strict(),
  z.object({ action: z.literal("transfer"), requestIds, assigneeId: entityIdSchema }).strict(),
  z.object({ action: z.literal("priority"), requestIds, priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]) }).strict(),
  z.object({ action: z.literal("sector"), requestIds, sectorId: entityIdSchema, note: z.string() }).strict(),
  z.object({ action: z.literal("tag"), requestIds, tagId: entityIdSchema }).strict(),
  z.object({ action: z.literal("untag"), requestIds, tagId: entityIdSchema }).strict(),
  z.object({ action: z.literal("duplicate"), requestIds, code: z.string(), note: z.string() }).strict(),
]);

export type BatchInput = z.output<typeof batchInputSchema>;

/** The individual actions, each with its own authorization and transaction. */
export interface BatchActions {
  assume(input: { requestId: string }): Promise<void>;
  transfer(input: { requestId: string; assigneeId: string }): Promise<void>;
  priority(input: { requestId: string; priority: string }): Promise<void>;
  sector(input: { requestId: string; sectorId: string; note: string }): Promise<void>;
  /** Puts the tag on, or takes it off, through the tags' own rules. */
  tag(input: { requestId: string; tagId: string }): Promise<void>;
  untag(input: { requestId: string; tagId: string }): Promise<void>;
  /** 13.5 item 2: the original, checked once (a wrong code refuses the batch). Optional for older doubles. */
  duplicateOriginal?(code: string): Promise<string>;
  /** Links the item to the original when needed, then closes it as a duplicate (rule 8.3). */
  duplicate?(input: { requestId: string; originalId: string; note: string }): Promise<void>;
}

export type BatchRefusal =
  | "no_access"
  | "taken"
  | "not_allowed"
  | "invalid_colleague"
  | "same_priority"
  | "invalid_sector"
  | "invalid_tag"
  | "invalid_duplicate"
  | "unexpected";

export const BATCH_REFUSAL_LABELS: Record<BatchRefusal, string> = {
  no_access: "sem permissão: não está mais na fila do seu setor",
  taken: "já tem responsável, não pode ser assumida agora ou mudou enquanto você agia",
  not_allowed: "a ação não vale para ela agora (outro responsável, outra situação) ou ela mudou enquanto você agia",
  invalid_colleague: "o colega escolhido não pode recebê-la",
  same_priority: "já está com essa prioridade",
  invalid_sector: "o setor escolhido não pode recebê-la",
  invalid_tag: "a etiqueta não é do setor dela, está inativa ou ela já tem 5 etiquetas",
  // SPEC 2026-11-08-atendimento-dia-a-dia, 13.5 item 2.
  invalid_duplicate: "é a própria original, já está vinculada a outra de outro jeito, tem 10 vínculos ou não pode ser encerrada agora",
  unexpected: "não foi possível concluir; tente de novo",
};

export type BatchItemResult = { requestId: string; outcome: "done" } | { requestId: string; outcome: "refused"; reason: BatchRefusal };

export interface BatchResult {
  action: BatchAction;
  items: BatchItemResult[];
  done: number;
  refused: number;
}

/** Why the individual action refused the item, as a fixed reason. */
export function refusalOf(action: BatchAction, error: unknown): BatchRefusal {
  if (!(error instanceof ApplicationError)) return "unexpected";
  if (error.code === "NOT_FOUND" || error.code === "FORBIDDEN" || error.code === "UNAUTHENTICATED") return "no_access";
  if (error.code === "CONFLICT" && action !== "duplicate") return action === "assume" ? "taken" : "not_allowed";
  if (error.code === "VALIDATION_ERROR") {
    if (action === "transfer") return "invalid_colleague";
    if (action === "priority") return "same_priority";
    if (action === "sector") return "invalid_sector";
    if (action === "tag" || action === "untag") return "invalid_tag";
  }
  // 13.5 item 2: the link refused (self, another original, limits) or the closing refused (state, holder).
  if (action === "duplicate" && (error.code === "CONFLICT" || error.code === "VALIDATION_ERROR")) return "invalid_duplicate";
  return "unexpected";
}

export async function runQueueBatch(input: unknown, actions: BatchActions): Promise<BatchResult> {
  // Only an attendant works the queue; each item checks the rest itself.
  assertRole(await requireCurrentActor(), "ATTENDANT");
  const batch = validateInput(batchInputSchema, input);
  // The same justification for every item (7.3 item 2): checked once, before any item.
  const note = batch.action === "sector" ? sectorTransferNote(batch.note) : batch.action === "duplicate" ? duplicateBatchNote(batch.note) : null;
  // 13.5 item 2: the original, once, before any item.
  const originalId = batch.action === "duplicate" ? await requiredDuplicateOriginal(actions, batch.code) : null;

  const items: BatchItemResult[] = [];
  // One after the other, so each item reads what the previous ones left (the distribution's turn, the load).
  for (const requestId of batch.requestIds) {
    try {
      if (batch.action === "assume") await actions.assume({ requestId });
      else if (batch.action === "transfer") await actions.transfer({ requestId, assigneeId: batch.assigneeId });
      else if (batch.action === "priority") await actions.priority({ requestId, priority: batch.priority });
      else if (batch.action === "tag") await actions.tag({ requestId, tagId: batch.tagId });
      else if (batch.action === "untag") await actions.untag({ requestId, tagId: batch.tagId });
      else if (batch.action === "duplicate") await actions.duplicate!({ requestId, originalId: originalId!, note: note! });
      else await actions.sector({ requestId, sectorId: batch.sectorId, note: note! });
      items.push({ requestId, outcome: "done" });
    } catch (error) {
      items.push({ requestId, outcome: "refused", reason: refusalOf(batch.action, error) });
    }
  }

  const done = items.filter((item) => item.outcome === "done").length;
  return { action: batch.action, items, done, refused: items.length - done };
}

/** 13.5 item 2: the same note for every item, mandatory as in closing one (1 to 1,000 characters). */
function duplicateBatchNote(value: string): string {
  const note = value.trim();
  if (note.length === 0 || note.length > 1_000) throw new ValidationError([{ path: ["note"], code: "invalid_value" }]);
  return note;
}

async function requiredDuplicateOriginal(actions: BatchActions, code: string): Promise<string> {
  if (!actions.duplicateOriginal || !actions.duplicate) throw new ValidationError([{ path: ["action"], code: "invalid_value" }]);
  return actions.duplicateOriginal(code);
}

export interface BatchChoices {
  /** Active attendants of the person's sector, other than the person, for "Transferir". */
  colleagues: Array<{ id: string; name: string }>;
  /** Sectors that may receive the sector's requests, for "Encaminhar". */
  sectors: Array<{ id: string; name: string }>;
}

/**
 * The choices of the batch form (7.3 item 2): the same lists the individual actions offer, for the person's
 * sector, since the page's requests are all of it. Each item is still checked by its action.
 */
export async function listBatchChoices(repository: Pick<RequestQueryRepository, "listSectorAttendants" | "listSectorDestinations">): Promise<BatchChoices> {
  const actor = assertRole(await requireCurrentActor(), "ATTENDANT");
  if (!actor.sectorId) return { colleagues: [], sectors: [] };
  const [attendants, sectors] = await Promise.all([repository.listSectorAttendants(actor.sectorId), repository.listSectorDestinations(actor.sectorId)]);
  return { colleagues: attendants.filter(({ id }) => id !== actor.id), sectors };
}
