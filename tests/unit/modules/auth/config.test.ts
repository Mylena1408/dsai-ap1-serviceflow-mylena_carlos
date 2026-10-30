import { describe, expect, it } from "vitest";
import {
  authConfig,
  authCredentialFields,
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

  it("does not expose role or sector as credential fields", () => {
    expect(authConfig.providers).toHaveLength(1);
    expect(authConfig.providers[0]?.id).toBe("credentials");
    expect(authCredentialFields).toEqual({
      email: { label: "E-mail", type: "email" },
      password: { label: "Senha", type: "password" },
    });
  });
});
