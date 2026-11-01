import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError, ValidationError } from "@/server/errors";

const notifications = vi.hoisted(() => ({ openNotification: vi.fn() }));
const authorization = vi.hoisted(() => ({ requireCurrentActor: vi.fn() }));
vi.mock("@/modules/notifications", () => notifications);
vi.mock("@/server/authorization", () => authorization);

import { GET } from "@/app/api/notifications/[notificationId]/route";

// SPEC 2026-10-31-eventos-outbox-jobs, section 8.2 (SF-064).

const call = () =>
  GET(new Request("http://localhost:3100/api/notifications/n-1"), { params: Promise.resolve({ notificationId: "n-1" }) });

describe("open notification route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects with a relative Location to the request page of each profile", async () => {
    notifications.openNotification.mockResolvedValue("request-1");

    authorization.requireCurrentActor.mockResolvedValueOnce({ id: "r", role: "REQUESTER" });
    const requester = await call();
    expect(requester.status).toBe(303);
    expect(requester.headers.get("location")).toBe("/requests/request-1");

    authorization.requireCurrentActor.mockResolvedValueOnce({ id: "a", role: "ATTENDANT" });
    expect((await call()).headers.get("location")).toBe("/queue/request-1");
  });

  it("goes back to the list when the notification is not the reader's", async () => {
    notifications.openNotification.mockResolvedValue(null);
    authorization.requireCurrentActor.mockResolvedValue({ id: "a", role: "ATTENDANT" });

    expect((await call()).headers.get("location")).toBe("/queue/notifications");
  });

  it("sends anonymous users to the login and invalid ids home", async () => {
    authorization.requireCurrentActor.mockRejectedValueOnce(new AuthenticationError());
    expect((await call()).headers.get("location")).toBe("/login");

    authorization.requireCurrentActor.mockResolvedValueOnce({ id: "r", role: "REQUESTER" });
    notifications.openNotification.mockRejectedValueOnce(new ValidationError([]));
    expect((await call()).headers.get("location")).toBe("/");
  });
});
