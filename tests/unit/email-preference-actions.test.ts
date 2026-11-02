import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError, AuthorizationError, ValidationError } from "@/server/errors";

// SPEC 2026-11-01-notificacoes-email-preferencias, 5.1 (SF-093): the form action of each area.

const notifications = vi.hoisted(() => ({ updateEmailPreferences: vi.fn(), markAllNotificationsRead: vi.fn() }));
const authorization = vi.hoisted(() => ({ requireCurrentActor: vi.fn() }));
const nextNavigation = vi.hoisted(() => ({
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("@/modules/notifications", () => notifications);
vi.mock("@/server/authorization", () => authorization);
vi.mock("next/navigation", () => nextNavigation);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { saveEmailPreferencesAction } from "@/app/_components/notification-actions";

function form(categories: string[]): FormData {
  const data = new FormData();
  for (const category of categories) data.append("category", category);
  return data;
}

const actAs = (role: string) => authorization.requireCurrentActor.mockResolvedValue({ id: "user-1", role, isActive: true });

describe("email preference action (SF-093)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notifications.updateEmailPreferences.mockResolvedValue(undefined);
  });

  it("saves the checked categories and returns to the preferences of the area", async () => {
    actAs("REQUESTER");
    await expect(saveEmailPreferencesAction(form(["STATUS", "SLA"]))).rejects.toThrow(
      "REDIRECT:/notifications/preferences?notice=saved",
    );
    expect(notifications.updateEmailPreferences).toHaveBeenCalledWith({ categories: ["STATUS", "SLA"] });

    actAs("ATTENDANT");
    await expect(saveEmailPreferencesAction(form([]))).rejects.toThrow("REDIRECT:/queue/notifications/preferences?notice=saved");
    expect(notifications.updateEmailPreferences).toHaveBeenLastCalledWith({ categories: [] });

    actAs("MANAGER");
    await expect(saveEmailPreferencesAction(form(["APPROVALS"]))).rejects.toThrow(
      "REDIRECT:/approvals/notifications/preferences?notice=saved",
    );
  });

  it("reports a tampered form and sends others away", async () => {
    actAs("REQUESTER");
    notifications.updateEmailPreferences.mockRejectedValueOnce(new ValidationError([{ path: ["categories", 0], code: "invalid_value" }]));
    await expect(saveEmailPreferencesAction(form(["SMS"]))).rejects.toThrow("REDIRECT:/notifications/preferences?notice=invalid");

    actAs("ADMIN");
    notifications.updateEmailPreferences.mockRejectedValueOnce(new AuthorizationError());
    await expect(saveEmailPreferencesAction(form([]))).rejects.toThrow("REDIRECT:/");

    authorization.requireCurrentActor.mockRejectedValueOnce(new AuthenticationError());
    await expect(saveEmailPreferencesAction(form([]))).rejects.toThrow("REDIRECT:/login");
  });
});
