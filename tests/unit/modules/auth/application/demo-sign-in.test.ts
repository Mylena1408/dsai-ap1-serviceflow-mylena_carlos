import { describe, expect, it, vi } from "vitest";
import type { DemoAccountStore } from "@/modules/auth/application/ports";
import { signInAsDemoUser } from "@/modules/auth/application/demo-sign-in";
import { DEMO_ACCOUNTS } from "@/modules/auth/domain/demo-accounts";

function store(): DemoAccountStore & { ensureDemoUser: ReturnType<typeof vi.fn> } {
  return {
    ensureDemoUser: vi.fn(async (role: keyof typeof DEMO_ACCOUNTS) => ({
      id: `id-${role}`,
      ...DEMO_ACCOUNTS[role],
    })),
  };
}

describe("signInAsDemoUser", () => {
  it.each(["ADMIN", "REQUESTER", "ATTENDANT"] as const)(
    "signs in with the %s demonstration account",
    async (role) => {
      const accounts = store();

      await expect(signInAsDemoUser({ role }, accounts)).resolves.toEqual({
        id: `id-${role}`,
        name: DEMO_ACCOUNTS[role].name,
        email: DEMO_ACCOUNTS[role].email,
      });
      expect(accounts.ensureDemoUser).toHaveBeenCalledWith(role);
    },
  );

  it("refuses unknown roles and extra fields without touching the store", async () => {
    const accounts = store();

    for (const input of [{ role: "ROOT" }, {}, { role: "ADMIN", sectorId: "x" }, null]) {
      await expect(signInAsDemoUser(input, accounts)).resolves.toBeNull();
    }
    expect(accounts.ensureDemoUser).not.toHaveBeenCalled();
  });

  it("uses distinct demonstration e-mails per role", () => {
    const emails = Object.values(DEMO_ACCOUNTS).map(({ email }) => email);
    // Four roles since SPEC 2026-11-01-aprovacoes (5.1) added the demonstration manager.
    expect(new Set(emails).size).toBe(4);
  });
});
