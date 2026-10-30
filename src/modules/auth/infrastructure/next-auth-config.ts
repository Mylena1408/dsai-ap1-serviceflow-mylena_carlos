import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { sessionFromToken, refreshSessionToken } from "./next-auth-session";
import { authenticateCredentials } from "./prisma-credentials";

const isProduction = process.env.NODE_ENV === "production";

export const authCredentialFields = {
  email: { label: "E-mail", type: "email" },
  password: { label: "Senha", type: "password" },
};

export const authConfig = {
  secret: process.env.AUTH_SECRET,
  pages: {
    signIn: "/login",
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
  ],
  callbacks: {
    jwt: async ({ token, user }) => refreshSessionToken(token, user?.id),
    session: async ({ session, token }) => sessionFromToken(session, token),
  },
} satisfies NextAuthConfig;
