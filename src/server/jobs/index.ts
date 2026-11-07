import { purgeApiRateWindows, purgeEndedApiTokens } from "@/modules/api-tokens";
import { purgeAuditEntries } from "@/modules/audit";
import { purgeProcessedEvents, runOutbox, type EventConsumer, type OutboxRunSummary } from "@/modules/events";
import {
  notificationConsumer,
  purgeEmailDeliveries,
  purgeReadNotifications,
  purgeUnreadNotifications,
  runEmailDeliveries,
  type EmailRunSummary,
} from "@/modules/notifications";
import {
  applyEscalationRules,
  cleanOrphanAttachmentObjects,
  recordApprovalDeadlineAlerts,
  recordSlaAlerts,
  recordStageDeadlineAlerts,
  type ApprovalDeadlineSummary,
  type EscalationRuleSummary,
  type StageDeadlineSummary,
  type OrphanCleanupSummary,
  type SlaAlertSummary,
} from "@/modules/requests";
import {
  purgeWebhookDeliveries,
  runWebhookDeliveries,
  webhookConsumer,
  type WebhookRunSummary,
} from "@/modules/webhooks";
import { isDocumentStorageConfigured } from "@/server/storage";
import { retentionCutoff } from "@/shared/retention";

// Composition of the event consumers and the daily job (SPEC 2026-10-31-eventos-outbox-
// jobs, sections 4 and 7). Consumers are registered here so modules never import each other.

// SPEC 2026-11-02-api-externa-webhooks, 5.6: the webhook consumer records the deliveries.
const consumers: EventConsumer[] = [notificationConsumer(), webhookConsumer()];

export function eventConsumers(): readonly EventConsumer[] {
  return consumers;
}

/** Runs one pass of the processor (used by `scheduleEventProcessing` in ./schedule). */
export async function processEventsNow(): Promise<OutboxRunSummary> {
  return runOutbox(consumers);
}

/** Sends the emails the events just recorded (SPEC 2026-11-01-notificacoes-email-preferencias, 5.3). */
export async function processEmailsNow(): Promise<EmailRunSummary> {
  return runEmailDeliveries();
}

/** Sends the webhook deliveries the events just recorded (SPEC 2026-11-02-api-externa-webhooks, 5.6). */
export async function processWebhooksNow(): Promise<WebhookRunSummary> {
  return runWebhookDeliveries();
}

export type DailyStep<T> = { status: "ok"; result: T } | { status: "skipped" } | { status: "error"; code: string };

export interface DailyJobSummary {
  slaAlerts: DailyStep<SlaAlertSummary>;
  /** SPEC 2026-11-06-aprofundamento-configurabilidade, 7.3. */
  escalationRules: DailyStep<EscalationRuleSummary>;
  /** SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.6. */
  approvalDeadlines: DailyStep<ApprovalDeadlineSummary>;
  /** 5.3.2. */
  stageDeadlines: DailyStep<StageDeadlineSummary>;
  events: DailyStep<OutboxRunSummary>;
  emails: DailyStep<EmailRunSummary>;
  purgedEvents: DailyStep<number>;
  purgedNotifications: DailyStep<number>;
  /** Retention (SPEC 2026-11-02-auditoria-lgpd, 5.3). */
  purgedUnreadNotifications: DailyStep<number>;
  purgedEmailDeliveries: DailyStep<number>;
  purgedAuditEntries: DailyStep<number>;
  /** SPEC 2026-11-02-api-externa-webhooks, 5.5 to 5.7. */
  webhooks: DailyStep<WebhookRunSummary>;
  purgedWebhookDeliveries: DailyStep<number>;
  purgedApiRateWindows: DailyStep<number>;
  purgedApiTokens: DailyStep<number>;
  orphanObjects: DailyStep<OrphanCleanupSummary>;
}

function errorCode(error: unknown): string {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown; reason?: unknown }) : {};
  if (typeof code.reason === "string") return code.reason;
  if (typeof code.code === "string") return code.code;
  return "UNKNOWN";
}

async function step<T>(run: () => Promise<T>): Promise<DailyStep<T>> {
  try {
    return { status: "ok", result: await run() };
  } catch (error) {
    return { status: "error", code: errorCode(error) };
  }
}

/** Skipped while no document storage is configured; a partial configuration is an error. */
async function orphanStep(now: Date): Promise<DailyStep<OrphanCleanupSummary>> {
  try {
    if (!isDocumentStorageConfigured()) {
      return { status: "skipped" };
    }
    return { status: "ok", result: await cleanOrphanAttachmentObjects(now) };
  } catch (error) {
    return { status: "error", code: errorCode(error) };
  }
}

/** Section 7: each task runs even if a previous one failed. */
export async function runDailyJob(now: Date = new Date()): Promise<DailyJobSummary> {
  // SLA alerts first, so their notifications go out in the same run (SPEC 2026-11-01, 5.5).
  const slaAlerts = await step(() => recordSlaAlerts(now));
  // The sectors' escalation rules, after the option's breach escalation and before the events, so
  // their warnings go out in the same run (SPEC 2026-11-06-aprofundamento-configurabilidade, 7.3).
  const escalationRules = await step(() => applyEscalationRules(now));
  // Late approval levels, also before the events (SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.6).
  const approvalDeadlines = await step(() => recordApprovalDeadlineAlerts(now));
  // Late stages too (SPEC 2026-11-06-aprofundamento-configurabilidade, 5.3.2).
  const stageDeadlines = await step(() => recordStageDeadlineAlerts(now));
  const events = await step(() => runOutbox(consumers, { maxBatches: 20 }));
  // After the events, so the emails they record go out in the same run.
  const emails = await step(() => runEmailDeliveries({ maxBatches: 20 }));
  const webhooks = await step(() => runWebhookDeliveries({ maxBatches: 20 }));
  // Retention: the deadlines of `RETENTION_PERIODS` (SPEC 2026-11-02-auditoria-lgpd, 5.3).
  const purgedEvents = await step(() => purgeProcessedEvents(retentionCutoff("processedEvents", now)));
  const purgedNotifications = await step(() => purgeReadNotifications(retentionCutoff("readNotifications", now)));
  const purgedUnreadNotifications = await step(() =>
    purgeUnreadNotifications(retentionCutoff("unreadNotifications", now)),
  );
  const purgedEmailDeliveries = await step(() => purgeEmailDeliveries(retentionCutoff("emailDeliveries", now)));
  const purgedAuditEntries = await step(() => purgeAuditEntries(retentionCutoff("auditEntries", now)));
  const purgedWebhookDeliveries = await step(() => purgeWebhookDeliveries(retentionCutoff("webhookDeliveries", now)));
  const purgedApiRateWindows = await step(() => purgeApiRateWindows(retentionCutoff("apiRateWindows", now)));
  const purgedApiTokens = await step(() => purgeEndedApiTokens(retentionCutoff("endedApiTokens", now)));
  const orphanObjects = await orphanStep(now);

  return {
    slaAlerts,
    escalationRules,
    approvalDeadlines,
    stageDeadlines,
    events,
    emails,
    purgedEvents,
    purgedNotifications,
    purgedUnreadNotifications,
    purgedEmailDeliveries,
    purgedAuditEntries,
    webhooks,
    purgedWebhookDeliveries,
    purgedApiRateWindows,
    purgedApiTokens,
    orphanObjects,
  };
}
