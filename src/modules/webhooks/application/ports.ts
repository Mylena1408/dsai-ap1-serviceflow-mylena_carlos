import type { AuditScope } from "@/modules/audit";
import type { DomainEventType } from "@/modules/events";
import type { WebhookAttemptResult } from "../domain/delivery";

// Persistence and transport of the webhooks (SPEC 2026-11-02-api-externa-webhooks, 5.6).

/** A webhook as the administration lists it: never its secret. */
export interface WebhookRecord {
  id: string;
  name: string;
  url: string;
  eventTypes: DomainEventType[];
  /** SPEC 2026-11-03-api-acoes-webhooks-setor, 5.2: empty means every sector. */
  sectorIds: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookSectorOption {
  id: string;
  name: string;
  isActive: boolean;
}

export type WebhookDeliveryStatus = "PENDING" | "DELIVERED" | "FAILED" | "CANCELLED";

/** One delivery in the follow-up list: never its body. */
export interface WebhookDeliveryRecord {
  id: string;
  webhookName: string;
  /** Whether the webhook is active: only then a delivery can be resent (5.3). */
  webhookActive: boolean;
  eventType: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  lastErrorCode: string | null;
  createdAt: Date;
  deliveredAt: Date | null;
}

export interface WebhookChanges {
  name?: string;
  url?: string;
  eventTypes?: DomainEventType[];
  sectorIds?: string[];
  isActive?: boolean;
  encryptedSecret?: string;
}

export interface WebhookTransaction extends AuditScope {
  currentTime(): Promise<Date>;
  countActive(): Promise<number>;
  insert(webhook: { name: string; url: string; eventTypes: DomainEventType[]; sectorIds: string[]; encryptedSecret: string }): Promise<{ id: string }>;
  /** Every sector, active or not, to check the sectors of the form (5.2). */
  existingSectorIds(): Promise<string[]>;
  findDelivery(deliveryId: string): Promise<{ id: string; status: WebhookDeliveryStatus; endpoint: { isActive: boolean } } | null>;
  /** Back to pending, attempts reset, available now (5.3). */
  requeueDelivery(deliveryId: string, at: Date): Promise<void>;
  find(webhookId: string): Promise<WebhookRecord | null>;
  update(webhookId: string, changes: WebhookChanges): Promise<{ id: string }>;
  /** Pending deliveries of a deactivated webhook become "cancelled"; returns how many. */
  cancelPending(webhookId: string): Promise<number>;
}

export interface WebhookTransactionRunner {
  run<T>(work: (transaction: WebhookTransaction) => Promise<T>): Promise<T>;
}

export interface WebhookReader {
  list(): Promise<WebhookRecord[]>;
  recentDeliveries(limit: number): Promise<WebhookDeliveryRecord[]>;
  sectors(): Promise<WebhookSectorOption[]>;
}

export interface PendingWebhookDelivery {
  id: string;
  eventType: string;
  /** The exact text to sign and send, kept since the event was recorded. */
  body: string;
  attempts: number;
  endpoint: { id: string; url: string; isActive: boolean; encryptedSecret: string };
}

export type WebhookDeliveryUpdate =
  | { status: "DELIVERED"; attempts: number; deliveredAt: Date }
  | { status: "PENDING"; attempts: number; availableAt: Date; lastErrorCode: string }
  | { status: "FAILED"; attempts: number; lastErrorCode: string }
  | { status: "CANCELLED" };

export interface WebhookDeliveryStore {
  /** Active webhooks that subscribe to the event type, with their sectors (empty = every sector). */
  subscribers(eventType: DomainEventType): Promise<Array<{ id: string; sectorIds: string[] }>>;
  /** Sector of the request, as recorded at the opening; null when it does not exist. */
  requestSector(requestId: string): Promise<string | null>;
  /** One delivery per event and webhook; a repeated event changes nothing (at-least-once outbox). */
  register(deliveries: Array<{ endpointId: string; eventId: string; eventType: string; body: string; at: Date }>): Promise<void>;
  claimPending(limit: number, leaseMs: number): Promise<{ deliveries: PendingWebhookDelivery[]; now: Date }>;
  save(deliveryId: string, update: WebhookDeliveryUpdate): Promise<void>;
}

export interface WebhookRequest {
  deliveryId: string;
  eventType: string;
  body: string;
  signature: string;
}

/** Sends one delivery: checks the resolved addresses, never follows redirects, gives up after 10 s. */
export interface WebhookTransport {
  post(url: string, request: WebhookRequest): Promise<WebhookAttemptResult>;
}
