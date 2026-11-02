import { AsyncLocalStorage } from "node:async_hooks";
import type { AuthenticatedUser } from "./index";

// The person of an API call (SPEC 2026-11-02-api-externa-webhooks, 5.3): while a /api/v1 call
// runs, the token owner is the authenticated user for every use case, and the browser session is
// never read. Outside a call, nothing changes.

const apiUsers = new AsyncLocalStorage<AuthenticatedUser>();

export function runAsApiUser<T>(user: AuthenticatedUser, work: () => Promise<T>): Promise<T> {
  return apiUsers.run(user, work);
}

export function currentApiUser(): AuthenticatedUser | undefined {
  return apiUsers.getStore();
}
