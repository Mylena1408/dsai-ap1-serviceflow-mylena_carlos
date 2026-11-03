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
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type WebhookDeliveryStatus = "PENDING" | "DELIVERED" | "FAILED" | "CANCELLED";

/** One delivery in the follow-up list: never its body. */
export interface WebhookDeliveryRecord {
  id: string;
  webhookName: string;
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
  isActive?: boolean;
  encryptedSecret?: string;
}

export interface WebhookTransaction extends AuditScope {
  currentTime(): Promise<Date>;
  countActive(): Promise<number>;
  insert(webhook: { name: string; url: string; eventTypes: DomainEventType[]; encryptedSecret: string }): Promise<{ id: string }>;
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
  /** Active webhooks that subscribe to the event type. */
  subscribers(eventType: DomainEventType): Promise<Array<{ id: string }>>;
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
