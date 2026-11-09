import { describe, expect, it } from "vitest";
import { plannedNotifications, type NotifiableEvent } from "@/modules/notifications/domain/recipients";
import { notificationCategory } from "@/modules/notifications/domain/email";
import { notificationMessage } from "@/shared/notifications";

// SPEC 2026-11-08-atendimento-dia-a-dia, 8.3 item 2 and 8.4 (SF-218).

const cancelled = (actorId: string): NotifiableEvent => ({
  type: "request.status_changed",
  payload: { toStatus: "CANCELLED", actorId },
});
const held = { requesterId: "lia", effectiveAssigneeId: "ana" };

describe("the notice of a duplicate's closing", () => {
  it("replaces the cancellation's notice to the requester when the reason is a duplicate", () => {
    expect(plannedNotifications(cancelled("ana"), { ...held, cancellationReason: "DUPLICATE" })).toEqual([
      { recipientId: "lia", type: "status.DUPLICATE" },
    ]);
  });

  it("keeps the plain cancellation without a reason, and other statuses ignore it", () => {
    expect(plannedNotifications(cancelled("ana"), { ...held, cancellationReason: null })).toEqual([
      { recipientId: "lia", type: "status.CANCELLED" },
    ]);
    expect(plannedNotifications(cancelled("ana"), held)).toEqual([{ recipientId: "lia", type: "status.CANCELLED" }]);
    expect(
      plannedNotifications({ type: "request.status_changed", payload: { toStatus: "COMPLETED", actorId: "ana" } }, {
        ...held,
        cancellationReason: "DUPLICATE",
      }),
    ).toEqual([{ recipientId: "lia", type: "status.COMPLETED" }]);
  });

  it("is a status notice with its own words", () => {
    expect(notificationCategory("status.DUPLICATE")).toBe("STATUS");
    expect(notificationMessage({ type: "status.DUPLICATE", serviceName: "Cadeira" })).toBe(
      "Encerrada como duplicada; você passa a acompanhar a original: Cadeira",
    );
  });
});
