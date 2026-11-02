import NextAuth from "next-auth";
import { createAuthConfig } from "@/modules/auth/infrastructure/next-auth-config";
import { ensureDemoDataLoaded } from "@/modules/demo";

// The fictitious data is loaded on the first demonstration click (SPEC 2026-09-30, section 25.2).
export const { handlers, auth, signIn, signOut } = NextAuth(
  createAuthConfig({ beforeDemoSignIn: () => ensureDemoDataLoaded() }),
);
