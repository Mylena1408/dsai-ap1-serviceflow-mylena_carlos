import type { PrismaClient } from "@prisma/client";
import { DOMAIN_EVENT_TYPES, type EventConsumer } from "@/modules/events";
import { prisma } from "@/server/db";
import * as admin from "./application/webhook-admin";
import * as delivery from "./application/webhook-delivery";
import { createHttpWebhookTransport, webhookEnvironment } from "./infrastructure/http-webhook-transport";
import * as persistence from "./infrastructure/prisma-webhooks";

// Public API of the webhooks module (SPEC 2026-11-02-api-externa-webhooks, 5.6 and 5.7).
export { WEBHOOK_URL_MAX_LENGTH, checkWebhookUrl, isBlockedAddress } from "./domain/address";
export type { WebhookAddressOptions, WebhookUrlCheck, WebhookUrlRefusal } from "./domain/address";
export {
  MAX_WEBHOOK_ATTEMPTS,
  MAX_WEBHOOKS,
  WEBHOOK_EVENT_LABELS,
  WEBHOOK_RETRY_DELAYS_MS,
  WEBHOOK_TIMEOUT_MS,
  canResendWebhookDelivery,
  checkWebhookEvents,
  checkWebhookSectors,
  normalizeWebhookName,
  webhookBody,
  webhookFailureCode,
  webhookAcceptsSector,
  webhookRetryPlan,
} from "./domain/delivery";
export type { WebhookAttemptResult, WebhookEvent, WebhookRetryPlan } from "./domain/delivery";
export {
  WEBHOOK_SECRET_PREFIX,
  decryptWebhookSecret,
  encryptWebhookSecret,
  generateWebhookSecret,
  parseWebhookEncryptionKey,
  webhookSignature,
} from "./domain/secret";
export type { WebhookDeliveryRecord, WebhookRecord } from "./application/ports";
export type { WebhookOverview, WebhookWithSecret } from "./application/webhook-admin";
export type { WebhookRunSummary } from "./application/webhook-delivery";
export { WEBHOOK_ENV_NAMES } from "./infrastructure/http-webhook-transport";

/** Read on every use, so a key set in the environment counts without a new deploy of the code. */
function settings(): admin.WebhookSettings {
  return { ...webhookEnvironment(), eventTypes: DOMAIN_EVENT_TYPES };
}

function deps(database: PrismaClient): admin.WebhookDeps {
  return { transactions: persistence.createPrismaWebhookTransactionRunner(database), settings: settings() };
}

/** Whether WEBHOOK_ENCRYPTION_KEY is set and valid (its value never leaves). */
export function isWebhookConfigured(): boolean {
  return webhookEnvironment().key !== null;
}

/** "Webhooks" section of the administration (5.6). */
export async function getWebhookOverview(database: PrismaClient = prisma): Promise<admin.WebhookOverview> {
  return admin.getWebhookOverview(persistence.createPrismaWebhookReader(database), settings());
}

export async function createWebhook(input: unknown, database: PrismaClient = prisma): Promise<admin.WebhookWithSecret> {
  return admin.createWebhook(input, deps(database));
}

export async function updateWebhook(input: unknown, database: PrismaClient = prisma): Promise<void> {
  return admin.updateWebhook(input, deps(database));
}

export async function setWebhookActive(input: unknown, database: PrismaClient = prisma): Promise<void> {
  return admin.setWebhookActive(input, deps(database));
}

export async function rotateWebhookSecret(input: unknown, database: PrismaClient = prisma): Promise<admin.WebhookWithSecret> {
  return admin.rotateWebhookSecret(input, deps(database));
}

/** Outbox consumer that records the deliveries (registered by src/server/jobs). */
export function webhookConsumer(database: PrismaClient = prisma): EventConsumer {
  return delivery.createWebhookConsumer(persistence.createPrismaWebhookDeliveryStore(database), isWebhookConfigured);
}

/** Sends the due deliveries: right after a response and in the daily job. */
export async function runWebhookDeliveries(
  options: { maxBatches?: number } = {},
  database: PrismaClient = prisma,
): Promise<delivery.WebhookRunSummary> {
  const { key, address } = webhookEnvironment();
  return delivery.processWebhookDeliveries(
    persistence.createPrismaWebhookDeliveryStore(database),
    key ? { key, transport: createHttpWebhookTransport(address) } : null,
    options,
  );
}

/** Retention (5.7). */
export async function purgeWebhookDeliveries(before: Date, database: PrismaClient = prisma): Promise<number> {
  return persistence.purgeWebhookDeliveries(database, before);
}
