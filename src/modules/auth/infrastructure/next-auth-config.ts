import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { sessionFromToken, refreshSessionToken } from "./next-auth-session";
import { authenticateCredentials } from "./prisma-credentials";
import { signInAsDemoUser } from "./prisma-demo-accounts";

const isProduction = process.env.NODE_ENV === "production";

export const authCredentialFields = {
  email: { label: "E-mail", type: "email" },
  password: { label: "Senha", type: "password" },
};

// Demonstration sign-in by role, without e-mail or password (SPEC 2026-09-30, section 22).
export const demoCredentialFields = {
  role: { label: "Perfil", type: "text" },
};

export interface AuthConfigOptions {
  /**
   * Runs before a demonstration sign-in (SPEC 2026-09-30, section 25.2): loads the fictitious
   * data on the first click. A failure is logged by code only and does not block the sign-in.
   */
  beforeDemoSignIn?: () => Promise<unknown>;
}

async function prepareDemo(options: AuthConfigOptions): Promise<void> {
  try {
    await options.beforeDemoSignIn?.();
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "UNKNOWN";
    console.error(`Demonstration data could not be loaded (${code}).`);
  }
}

export function createAuthConfig(options: AuthConfigOptions = {}) {
  return {
    secret: process.env.AUTH_SECRET,
    pages: {
      signIn: "/",
    },
    session: {
      strategy: "jwt",
      maxAge: 8 * 60 * 60,
    },
    cookies: {
      sessionToken: {
        name: isProduction ? "__Secure-authjs.session-token" : "authjs.session-token",
        options: {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          secure: isProduction,
        },
      },
    },
    providers: [
      Credentials({
        credentials: authCredentialFields,
        authorize: (credentials) =>
          authenticateCredentials({
            email: credentials?.email,
            password: credentials?.password,
          }),
      }),
      Credentials({
        id: "demo",
        name: "Demonstração",
        credentials: demoCredentialFields,
        authorize: async (credentials) => {
          await prepareDemo(options);
          return signInAsDemoUser({ role: credentials?.role });
        },
      }),
    ],
    callbacks: {
      jwt: async ({ token, user }) => refreshSessionToken(token, user?.id),
      session: async ({ session, token }) => sessionFromToken(session, token),
    },
  } satisfies NextAuthConfig;
}

export const authConfig = createAuthConfig();
