import NextAuth from "next-auth";
import { authConfig } from "@/modules/auth/infrastructure/next-auth-config";

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
