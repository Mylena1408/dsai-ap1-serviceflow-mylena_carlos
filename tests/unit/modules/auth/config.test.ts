import { describe, expect, it } from "vitest";
import {
  authConfig,
  authCredentialFields,
  demoCredentialFields,
} from "../../../../src/modules/auth/infrastructure/next-auth-config";

describe("Auth.js configuration", () => {
  it("uses short-lived JWT sessions and secure HttpOnly session cookies", () => {
    expect(authConfig.session).toEqual({
      strategy: "jwt",
      maxAge: 8 * 60 * 60,
    });
    expect(authConfig.cookies?.sessionToken).toMatchObject({
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: false,
      },
    });
  });

  // SPEC section 22 (2026-10-29) replaced the former "does not expose role or sector as
  // credential fields" rule: demonstration sign-in chooses the role, never the sector.
  it("keeps e-mail and password sign-in and adds role-only demonstration sign-in", () => {
    // Auth.js merges the configured id (kept in `options`) into the provider at runtime.
    const providerIds = authConfig.providers.map(
      (provider) => (provider as { options?: { id?: string } }).options?.id ?? provider.id,
    );
    expect(providerIds).toEqual(["credentials", "demo"]);
    expect(authCredentialFields).toEqual({
      email: { label: "E-mail", type: "email" },
      password: { label: "Senha", type: "password" },
    });
    expect(demoCredentialFields).toEqual({
      role: { label: "Perfil", type: "text" },
    });
  });
});
