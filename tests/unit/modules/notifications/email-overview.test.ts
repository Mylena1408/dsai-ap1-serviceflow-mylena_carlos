import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "@/server/errors";
import type { EmailDeliveryLog } from "@/modules/notifications/application/ports";

const authorization = vi.hoisted(() => ({ requireConfigurationAdministrator: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import { RECENT_EMAIL_DELIVERIES, getEmailOverview } from "@/modules/notifications/application/email-overview";

// SPEC 2026-11-01-notificacoes-email-preferencias, 5.5 (SF-095; CA-MAIL-09).

const delivery = {
  id: "d1",
  recipientName: "Rita",
  recipientEmail: "rita@example.test",
  type: "status.COMPLETED" as const,
  status: "SKIPPED" as const,
  attempts: 0,
  createdAt: new Date("2026-11-01T12:00:00.000Z"),
  sentAt: null,
  lastErrorCode: "not_configured",
};

describe("email overview (SF-095)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gives the administrator the configuration state and the 50 latest deliveries (CA-MAIL-09)", async () => {
    authorization.requireConfigurationAdministrator.mockResolvedValue({ id: "admin", role: "ADMIN" });
    const log: EmailDeliveryLog = { listRecent: vi.fn(async () => [delivery]) };

    await expect(getEmailOverview(log, false)).resolves.toEqual({ configured: false, deliveries: [delivery] });
    await expect(getEmailOverview(log, true)).resolves.toMatchObject({ configured: true });
    expect(log.listRecent).toHaveBeenCalledWith(RECENT_EMAIL_DELIVERIES);
    expect(RECENT_EMAIL_DELIVERIES).toBe(50);
  });

  it("refuses anyone else before reading anything (CA-MAIL-09)", async () => {
    authorization.requireConfigurationAdministrator.mockRejectedValue(new AuthorizationError());
    const log: EmailDeliveryLog = { listRecent: vi.fn(async () => [delivery]) };

    await expect(getEmailOverview(log, true)).rejects.toBeInstanceOf(AuthorizationError);
    expect(log.listRecent).not.toHaveBeenCalled();
  });
});
