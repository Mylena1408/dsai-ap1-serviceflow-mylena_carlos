// Outbox events (SPEC 2026-10-31-eventos-outbox-jobs). Other modules record events inside
// their own transactions through `recordOutboxEvent`; processing comes in SF-062.
export { DOMAIN_EVENT_TYPES, outboxPayload } from "./domain/domain-event";
export type { DomainEvent, DomainEventType, EventRequestStatus } from "./domain/domain-event";
export { recordOutboxEvent } from "./infrastructure/prisma-outbox";
