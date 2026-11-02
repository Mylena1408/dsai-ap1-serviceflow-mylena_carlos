import type { Page } from "@playwright/test";

// SPEC 2026-09-30, section 24: the root is the entrance and there is no login screen.

/** The entrance address (the root of the application). */
export const ENTRANCE = /^https?:\/\/[^/]+\/$/;

/**
 * Signs in with e-mail and password through the Auth.js route, which stays on the server
 * without a screen (section 24.1, item 5). The browser context shares the cookies, so the
 * page is signed in afterwards. Returns whether a session started.
 */
export async function passwordSignIn(page: Page, email: string, password: string): Promise<boolean> {
  const { csrfToken } = (await (await page.request.get("/api/auth/csrf")).json()) as { csrfToken: string };
  await page.request.post("/api/auth/callback/credentials", {
    form: { email, password, csrfToken, callbackUrl: "/" },
    maxRedirects: 0,
  });
  const session = (await (await page.request.get("/api/auth/session")).json()) as { user?: unknown } | null;
  return Boolean(session?.user);
}
