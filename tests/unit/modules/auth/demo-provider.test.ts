import { beforeEach, describe, expect, it, vi } from "vitest";

const accounts = vi.hoisted(() => ({ signInAsDemoUser: vi.fn() }));

vi.mock("../../../../src/modules/auth/infrastructure/prisma-demo-accounts", () => accounts);
vi.mock("../../../../src/modules/auth/infrastructure/prisma-credentials", () => ({ authenticateCredentials: vi.fn() }));

import { createAuthConfig } from "../../../../src/modules/auth/infrastructure/next-auth-config";

// SPEC 2026-09-30, section 25.2 (CA-FIC-01): the demonstration provider loads the fictitious
// data before signing in, and a failure of the loading never blocks the sign-in.

type Authorize = (credentials: Record<string, unknown>) => Promise<unknown>;

function demoAuthorize(beforeDemoSignIn: () => Promise<unknown>): Authorize {
  const provider = createAuthConfig({ beforeDemoSignIn }).providers[1] as unknown as {
    options: { authorize: Authorize };
  };
  return provider.options.authorize;
}

describe("demonstration provider", () => {
  const person = { id: "u1", name: "Ana Souza", email: "ana.souza@exemplo.test" };

  beforeEach(() => {
    vi.clearAllMocks();
    accounts.signInAsDemoUser.mockResolvedValue(person);
  });

  it("loads the fictitious data first, then signs in as the person of the role", async () => {
    const order: string[] = [];
    const load = vi.fn(async () => order.push("load"));
    accounts.signInAsDemoUser.mockImplementation(async () => {
      order.push("sign-in");
      return person;
    });

    await expect(demoAuthorize(load)({ role: "REQUESTER" })).resolves.toEqual(person);
    expect(order).toEqual(["load", "sign-in"]);
    expect(accounts.signInAsDemoUser).toHaveBeenCalledWith({ role: "REQUESTER" });
  });

  it("still signs in when the loading fails, logging only the code", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failure = Object.assign(new Error("secret detail"), { code: "P2034" });

    await expect(demoAuthorize(() => Promise.reject(failure))({ role: "ATTENDANT" })).resolves.toEqual(person);
    expect(error).toHaveBeenCalledWith("Demonstration data could not be loaded (P2034).");
    expect(JSON.stringify(error.mock.calls)).not.toContain("secret detail");
    error.mockRestore();
  });
});
