// Public API of the auth module. Compositions live in infrastructure/ files that each
// load only what they need, so callers and tests are not forced to load Auth.js.
//
// The Auth.js configuration is composed in the root auth.ts, which imports
// ./infrastructure/next-auth-config directly. Exporting it here would create the cycle
// index → change-own-password → @/server/authorization → @/server/auth → auth.ts → index.

export { hashPassword, verifyPassword } from "./infrastructure/argon2-password";
export { authenticateCredentials } from "./infrastructure/prisma-credentials";
export type { AuthenticatedCredentials } from "./infrastructure/prisma-credentials";
export {
  changeOwnPassword,
  CurrentPasswordMismatchError,
} from "./infrastructure/prisma-password-change";
export { refreshSessionToken, sessionFromToken } from "./infrastructure/next-auth-session";
export { bootstrapFirstAdmin } from "./infrastructure/prisma-bootstrap-admin";
export type { BootstrapAdminResult } from "./infrastructure/prisma-bootstrap-admin";
export { ChangePasswordForm } from "./ui/change-password-form";
export type { PasswordChangeAction, PasswordChangeState } from "./ui/change-password-form";
export { DEMO_ACCOUNTS, DEMO_SECTOR_NAME } from "./domain/demo-accounts";
export { signInAsDemoUser } from "./infrastructure/prisma-demo-accounts";
export { DemoSignInButtons } from "./ui/demo-sign-in-buttons";
export { LoginForm } from "./ui/login-form";
export { SignOutButton } from "./ui/sign-out-button";
