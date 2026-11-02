import { describe, expect, it } from "vitest";
import { MAX_EVENT_ATTEMPTS, retryDelayMs } from "@/modules/events";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_TYPES,
  nextDeliveryState,
  notificationCategory,
  typesOfCategory,
  wantsEmail,
  type EmailDeliveryState,
} from "@/modules/notifications/domain/email";

// SPEC 2026-11-01-notificacoes-email-preferencias, sections 5.1 to 5.3 (SF-092; CA-MAIL-02).

describe("notification categories (SF-092)", () => {
  it("puts every notification type in exactly one category of table 5.1 (CA-MAIL-02)", () => {
    expect(NOTIFICATION_CATEGORIES).toEqual(["STATUS", "ASSIGNMENT", "COMMENTS", "SLA", "STAGES", "APPROVALS"]);
    expect(Object.fromEntries(NOTIFICATION_CATEGORIES.map((category) => [category, typesOfCategory(category)]))).toEqual({
      STATUS: ["status.IN_PROGRESS", "status.COMPLETED", "status.CANCELLED", "status.OPEN"],
      ASSIGNMENT: ["assignment.received"],
      COMMENTS: ["comment.public", "comment.internal"],
      SLA: ["sla.warning", "sla.breached"],
      STAGES: ["stage.changed"],
      APPROVALS: ["approval.requested", "approval.approved", "approval.rejected"],
    });
    const listed = NOTIFICATION_CATEGORIES.flatMap(typesOfCategory);
    expect(listed).toHaveLength(NOTIFICATION_TYPES.length);
    expect(new Set(listed)).toEqual(new Set(NOTIFICATION_TYPES));
  });

  it("sends email only for categories the person turned on; everything starts off", () => {
    expect(NOTIFICATION_TYPES.some((type) => wantsEmail(type, new Set()))).toBe(false);
    const enabled = new Set(["SLA", "APPROVALS"] as const);
    expect(wantsEmail("sla.breached", enabled)).toBe(true);
    expect(wantsEmail("approval.requested", enabled)).toBe(true);
    expect(wantsEmail("comment.public", enabled)).toBe(false);
    expect(notificationCategory("comment.internal")).toBe("COMMENTS");
  });
});

describe("email delivery state (SF-092)", () => {
  const now = new Date("2026-11-01T12:00:00.000Z");
  const pending: EmailDeliveryState = { status: "PENDING", attempts: 0, availableAt: now, sentAt: null, lastErrorCode: null };

  it("marks a sent delivery with the time and counts the attempt", () => {
    expect(nextDeliveryState({ ...pending, lastErrorCode: "HTTP_500", attempts: 2 }, { kind: "sent" }, now)).toEqual({
      ...pending,
      status: "SENT",
      attempts: 3,
      sentAt: now,
      lastErrorCode: null,
    });
  });

  it("retries a failure with the outbox waits and fails after the last attempt, keeping only the code", () => {
    const retried = nextDeliveryState(pending, { kind: "failed", code: "HTTP_503" }, now);
    expect(retried).toEqual({
      ...pending,
      attempts: 1,
      availableAt: new Date(now.getTime() + retryDelayMs(1)),
      lastErrorCode: "HTTP_503",
    });

    const last = nextDeliveryState({ ...pending, attempts: MAX_EVENT_ATTEMPTS - 1 }, { kind: "failed", code: "HTTP_503" }, now);
    expect(last).toMatchObject({ status: "FAILED", attempts: MAX_EVENT_ATTEMPTS, lastErrorCode: "HTTP_503" });
  });

  it("skips without counting an attempt when email is not configured or the person is inactive", () => {
    expect(nextDeliveryState(pending, { kind: "skipped", reason: "not_configured" }, now)).toEqual({
      ...pending,
      status: "SKIPPED",
      lastErrorCode: "not_configured",
    });
    expect(nextDeliveryState(pending, { kind: "skipped", reason: "recipient_inactive" }, now)).toMatchObject({
      status: "SKIPPED",
      attempts: 0,
      lastErrorCode: "recipient_inactive",
    });
  });

  it("never changes a delivery that is no longer pending", () => {
    for (const status of ["SENT", "FAILED", "SKIPPED"] as const) {
      expect(() => nextDeliveryState({ ...pending, status }, { kind: "sent" }, now)).toThrow();
    }
  });
});
