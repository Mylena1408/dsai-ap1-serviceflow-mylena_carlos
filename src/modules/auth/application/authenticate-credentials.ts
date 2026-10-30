import { z } from "zod";
import { emailSchema } from "@/shared/validation";
import type { AuthUserRepository, PasswordHasher } from "./ports";

const credentialsSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1),
  })
  .strict();

export interface AuthenticatedCredentials {
  id: string;
  name: string;
  email: string;
}

export async function authenticateCredentials(
  credentials: unknown,
  users: AuthUserRepository,
  passwords: PasswordHasher,
): Promise<AuthenticatedCredentials | null> {
  const parsed = credentialsSchema.safeParse(credentials);

  if (!parsed.success) {
    return null;
  }

  const user = await users.findCredentialUserByEmail(parsed.data.email);

  if (!user?.isActive || !(await passwords.verify(user.passwordHash, parsed.data.password))) {
    return null;
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
  };
}
