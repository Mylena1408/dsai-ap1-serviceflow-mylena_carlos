import { z } from "zod";
import type { DomainEventType } from "@/modules/events";
import { requireConfigurationAdministrator } from "@/server/authorization";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";
import { checkWebhookUrl, type WebhookAddressOptions } from "../domain/address";
import {
  MAX_WEBHOOKS,
  WEBHOOK_NAME_MAX_LENGTH,
  canResendWebhookDelivery,
  checkWebhookEvents,
  checkWebhookSectors,
} from "../domain/delivery";
import { encryptWebhookSecret, generateWebhookSecret } from "../domain/secret";
import type {
  WebhookDeliveryRecord,
  WebhookReader,
  WebhookRecord,
  WebhookSectorOption,
  WebhookTransaction,
  WebhookTransactionRunner,
} from "./ports";

// Webhooks of the administration (SPEC 2026-11-02-api-externa-webhooks, 5.6 and 5.7; decision A5).

export const RECENT_WEBHOOK_DELIVERIES = 50;

export interface WebhookSettings {
  /** The key of WEBHOOK_ENCRYPTION_KEY, or null when webhooks are not configured. */
  key: Buffer | null;
  address: WebhookAddressOptions;
  /** Event types the outbox knows. */
  eventTypes: readonly DomainEventType[];
}

export interface WebhookDeps {
  transactions: WebhookTransactionRunner;
  settings: WebhookSettings;
}

export interface WebhookOverview {
  configured: boolean;
  webhooks: WebhookRecord[];
  deliveries: WebhookDeliveryRecord[];
  /** Sectors to choose from (SPEC 2026-11-03-api-acoes-webhooks-setor, 5.2). */
  sectors: WebhookSectorOption[];
}

/** The secret goes back only in this answer, shown once (5.6). */
export interface WebhookWithSecret {
  webhook: { id: string; name: string };
  secret: string;
}

const formSchema = z
  .object({
    name: z.string().trim().min(1).max(WEBHOOK_NAME_MAX_LENGTH),
    url: z.string(),
    eventTypes: z.array(z.string()),
    // SPEC 2026-11-03-api-acoes-webhooks-setor, 5.2: optional; empty means every sector.
    sectorIds: z.array(z.string()).max(200).optional(),
  })
  .strict();

const updateSchema = formSchema.extend({ webhookId: entityIdSchema }).strict();
const idSchema = z.object({ webhookId: entityIdSchema }).strict();
const activeSchema = z.object({ webhookId: entityIdSchema, isActive: z.boolean() }).strict();
const deliverySchema = z.object({ deliveryId: entityIdSchema }).strict();

/** Name, URL and events of the form, checked by the rules of 5.6; refusals name the field. */
function checkedForm(input: z.infer<typeof formSchema>, settings: WebhookSettings) {
  const url = checkWebhookUrl(input.url, settings.address);
  if (!url.ok) throw new ValidationError([{ path: ["url"], code: "invalid_value" }]);
  const eventTypes = checkWebhookEvents(input.eventTypes, settings.eventTypes);
  if (!eventTypes) throw new ValidationError([{ path: ["eventTypes"], code: "invalid_value" }]);
  return { name: input.name, url: url.url, eventTypes };
}

/** Section 5.2: the chosen sectors must exist (inactive ones still count for old requests). */
async function checkedSectors(selected: readonly string[] | undefined, transaction: WebhookTransaction): Promise<string[]> {
  const sectorIds = checkWebhookSectors(selected ?? [], await transaction.existingSectorIds());
  if (!sectorIds) throw new ValidationError([{ path: ["sectorIds"], code: "invalid_value" }]);
  return sectorIds;
}

function requireKey(settings: WebhookSettings): Buffer {
  // Without the key nothing can be signed, so nothing is created (5.6).
  if (!settings.key) throw new ConflictError();
  return settings.key;
}

export async function getWebhookOverview(reader: WebhookReader, settings: WebhookSettings): Promise<WebhookOverview> {
  await requireConfigurationAdministrator();
  const [webhooks, deliveries, sectors] = await Promise.all([
    reader.list(),
    reader.recentDeliveries(RECENT_WEBHOOK_DELIVERIES),
    reader.sectors(),
  ]);
  return { configured: settings.key !== null, webhooks, deliveries, sectors };
}

export async function createWebhook(input: unknown, { transactions, settings }: WebhookDeps): Promise<WebhookWithSecret> {
  const actor = await requireConfigurationAdministrator();
  const key = requireKey(settings);
  const parsed = validateInput(formSchema, input);
  const form = checkedForm(parsed, settings);
  const secret = generateWebhookSecret();

  return transactions.run(async (transaction) => {
    if ((await transaction.countActive()) >= MAX_WEBHOOKS) throw new ConflictError();
    const sectorIds = await checkedSectors(parsed.sectorIds, transaction);
    const created = await transaction.audited({ actor, action: "CREATED", entityType: "WEBHOOK" }, () =>
      transaction.insert({ ...form, sectorIds, encryptedSecret: encryptWebhookSecret(secret, key) }),
    );
    return { webhook: { id: created.id, name: form.name }, secret };
  });
}

export async function updateWebhook(input: unknown, { transactions, settings }: WebhookDeps): Promise<void> {
  const actor = await requireConfigurationAdministrator();
  const { webhookId, ...rest } = validateInput(updateSchema, input);
  const form = checkedForm(rest, settings);

  await transactions.run(async (transaction) => {
    if (!(await transaction.find(webhookId))) throw new NotFoundError();
    const sectorIds = await checkedSectors(rest.sectorIds, transaction);
    await transaction.audited({ actor, action: "UPDATED", entityType: "WEBHOOK", entityId: webhookId }, () =>
      transaction.update(webhookId, { ...form, sectorIds }),
    );
  });
}

/** Deactivating stops new deliveries and cancels the pending ones; reactivating respects the limit. */
export async function setWebhookActive(input: unknown, { transactions }: WebhookDeps): Promise<void> {
  const actor = await requireConfigurationAdministrator();
  const { webhookId, isActive } = validateInput(activeSchema, input);

  await transactions.run(async (transaction) => {
    const webhook = await transaction.find(webhookId);
    if (!webhook) throw new NotFoundError();
    if (webhook.isActive === isActive) return;
    if (isActive && (await transaction.countActive()) >= MAX_WEBHOOKS) throw new ConflictError();

    await transaction.audited(
      { actor, action: isActive ? "REACTIVATED" : "DEACTIVATED", entityType: "WEBHOOK", entityId: webhookId },
      () => transaction.update(webhookId, { isActive }),
    );
    if (!isActive) await transaction.cancelPending(webhookId);
  });
}

/** "Gerar novo segredo": the old secret stops signing at once; recorded without any secret. */
export async function rotateWebhookSecret(input: unknown, { transactions, settings }: WebhookDeps): Promise<WebhookWithSecret> {
  const actor = await requireConfigurationAdministrator();
  const key = requireKey(settings);
  const { webhookId } = validateInput(idSchema, input);
  const secret = generateWebhookSecret();

  return transactions.run(async (transaction) => {
    const webhook = await transaction.find(webhookId);
    if (!webhook) throw new NotFoundError();
    await transaction.audited({ actor, action: "SECRET_ROTATED", entityType: "WEBHOOK", entityId: webhookId }, () =>
      transaction.update(webhookId, { encryptedSecret: encryptWebhookSecret(secret, key) }),
    );
    return { webhook: { id: webhook.id, name: webhook.name }, secret };
  });
}

/**
 * "Reenviar" (SPEC 2026-11-03-api-acoes-webhooks-setor, 5.3; decision W3): a failed or cancelled
 * delivery of an active webhook goes back to pending, with the same body and identifier and the
 * attempts reset. An operation of follow-up, like the emails: not recorded in the audit.
 */
export async function resendWebhookDelivery(input: unknown, { transactions }: WebhookDeps): Promise<void> {
  await requireConfigurationAdministrator();
  const { deliveryId } = validateInput(deliverySchema, input);

  await transactions.run(async (transaction) => {
    const delivery = await transaction.findDelivery(deliveryId);
    if (!delivery) throw new NotFoundError();
    if (!canResendWebhookDelivery(delivery, delivery.endpoint)) throw new ConflictError();
    await transaction.requeueDelivery(deliveryId, await transaction.currentTime());
  });
}
