import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError, AuthorizationError, ValidationError } from "@/server/errors";
import type { NotificationPreferenceStore } from "@/modules/notifications/application/ports";
import type { NotificationCategory } from "@/modules/notifications/domain/email";

const authorization = vi.hoisted(() => ({ requireCurrentActor: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import { getEmailPreferences, updateEmailPreferences } from "@/modules/notifications/application/preference-use-cases";

// SPEC 2026-11-01-notificacoes-email-preferencias, 5.1 and 5.6 (SF-093; CA-MAIL-03).

function memoryStore() {
  const rows = new Map<string, Map<NotificationCategory, boolean>>();
  const store: NotificationPreferenceStore = {
    async enabledCategories(userId) {
      return new Set([...(rows.get(userId) ?? new Map())].filter(([, on]) => on).map(([category]) => category));
    },
    async save(userId, choices) {
      rows.set(userId, new Map(Object.entries(choices) as Array<[NotificationCategory, boolean]>));
    },
  };
  return { store, rows };
}

const actAs = (id: string, role: string) =>
  authorization.requireCurrentActor.mockResolvedValue({ id, role, isActive: true, sectorId: null, name: id, email: `${id}@example.test` });

const allOff = { STATUS: false, ASSIGNMENT: false, COMMENTS: false, SLA: false, STAGES: false, APPROVALS: false };

describe("email preferences (SF-093)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts with every category off (CA-MAIL-03)", async () => {
    const { store } = memoryStore();
    actAs("rita", "REQUESTER");

    await expect(getEmailPreferences(store)).resolves.toEqual(allOff);
  });

  it("turns on the listed categories and off the others, only for the signed-in person (CA-MAIL-03)", async () => {
    const { store, rows } = memoryStore();
    actAs("ana", "ATTENDANT");

    await updateEmailPreferences({ categories: ["SLA", "ASSIGNMENT"] }, store);
    await expect(getEmailPreferences(store)).resolves.toEqual({ ...allOff, SLA: true, ASSIGNMENT: true });

    await updateEmailPreferences({ categories: ["COMMENTS"] }, store);
    await expect(getEmailPreferences(store)).resolves.toEqual({ ...allOff, COMMENTS: true });
    expect([...rows.keys()]).toEqual(["ana"]);
    expect(rows.get("ana")?.size).toBe(6);
  });

  it("never takes a user from the input", async () => {
    const { store } = memoryStore();
    actAs("gabi", "MANAGER");

    await expect(updateEmailPreferences({ categories: ["SLA"], userId: "rita" }, store)).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses unknown categories, a non-list value and more entries than the list", async () => {
    const { store } = memoryStore();
    actAs("rita", "REQUESTER");

    await expect(updateEmailPreferences({ categories: ["SMS"] }, store)).rejects.toBeInstanceOf(ValidationError);
    await expect(updateEmailPreferences({ categories: "SLA" }, store)).rejects.toBeInstanceOf(ValidationError);
    await expect(updateEmailPreferences({ categories: Array(7).fill("SLA") }, store)).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses administrators, who receive no notifications, and anonymous visitors", async () => {
    const { store } = memoryStore();
    actAs("admin", "ADMIN");
    await expect(getEmailPreferences(store)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(updateEmailPreferences({ categories: [] }, store)).rejects.toBeInstanceOf(AuthorizationError);

    authorization.requireCurrentActor.mockRejectedValue(new AuthenticationError());
    await expect(getEmailPreferences(store)).rejects.toBeInstanceOf(AuthenticationError);
  });
});
