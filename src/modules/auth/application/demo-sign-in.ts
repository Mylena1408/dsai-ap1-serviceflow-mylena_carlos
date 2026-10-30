import { z } from "zod";
import { DEMO_ROLES } from "../domain/demo-accounts";
import type { AuthenticatedCredentials } from "./authenticate-credentials";
import type { DemoAccountStore } from "./ports";

const demoSignInSchema = z
  .object({
    role: z.enum(DEMO_ROLES),
  })
  .strict();

/**
 * Signs in with the demonstration account of the requested role, creating or
 * restoring it when needed (SPEC 2026-09-30, section 22). Invalid input yields null,
 * like a failed credential check.
 */
export async function signInAsDemoUser(
  input: unknown,
  accounts: DemoAccountStore,
): Promise<AuthenticatedCredentials | null> {
  const parsed = demoSignInSchema.safeParse(input);

  if (!parsed.success) {
    return null;
  }

  return accounts.ensureDemoUser(parsed.data.role);
}
