import { z } from "zod";
import { ConflictError, ValidationError } from "@/server/errors";
import { emailSchema, nameSchema } from "@/shared/validation";
import type { AdministratorBootstrapStore, PasswordHasher } from "./ports";

const bootstrapAdminInputSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    password: z.string().min(1),
  })
  .strict();

export interface BootstrapAdminResult {
  id: string;
  name: string;
  email: string;
}

export async function bootstrapFirstAdmin(
  input: unknown,
  store: AdministratorBootstrapStore,
  passwords: PasswordHasher,
): Promise<BootstrapAdminResult> {
  const parsed = bootstrapAdminInputSchema.safeParse(input);

  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map(({ path, code }) => ({
        path: path.filter(
          (segment): segment is string | number =>
            typeof segment === "string" || typeof segment === "number",
        ),
        code,
      })),
    );
  }

  if (await store.countAdministrators()) {
    throw new ConflictError();
  }

  const passwordHash = await passwords.hash(parsed.data.password);

  return store.run(async (transaction) => {
    if (await transaction.countAdministrators()) {
      throw new ConflictError();
    }

    return transaction.createAdministrator({
      name: parsed.data.name,
      email: parsed.data.email,
      passwordHash,
    });
  });
}
