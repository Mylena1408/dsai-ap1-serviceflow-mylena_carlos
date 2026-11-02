// Public API of the webhooks module (SPEC 2026-11-02-api-externa-webhooks). SF-111 brings the
// rules; registration, the outbox consumer and the deliveries come in SF-114.
export { WEBHOOK_URL_MAX_LENGTH, checkWebhookUrl, isBlockedAddress } from "./domain/address";
export type { WebhookAddressOptions, WebhookUrlCheck, WebhookUrlRefusal } from "./domain/address";
export {
  MAX_WEBHOOK_ATTEMPTS,
  MAX_WEBHOOKS,
  WEBHOOK_EVENT_LABELS,
  WEBHOOK_RETRY_DELAYS_MS,
  WEBHOOK_TIMEOUT_MS,
  checkWebhookEvents,
  normalizeWebhookName,
  webhookBody,
  webhookFailureCode,
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
