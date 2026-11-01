import { z } from "zod";
import { emailSchema, entityIdSchema, nameSchema } from "@/shared/validation";

const userRoleSchema = z.enum(["ADMIN", "REQUESTER", "ATTENDANT", "MANAGER"]);

// Attendants and managers belong to one sector (SPEC 2026-11-01-aprovacoes, 5.1).
export function roleRequiresSector(role: z.infer<typeof userRoleSchema>): boolean {
  return role === "ATTENDANT" || role === "MANAGER";
}
const sectorAssignmentSchema = entityIdSchema.nullable().optional();

function validateUserRoleSector(
  user: { role: z.infer<typeof userRoleSchema>; sectorId?: string | null },
  context: z.RefinementCtx,
): void {
  const hasSector = user.sectorId !== undefined && user.sectorId !== null;

  if (roleRequiresSector(user.role) && !hasSector) {
    context.addIssue({
      code: "custom",
      path: ["sectorId"],
      message: "Attendants and managers require a sector.",
    });
  }

  if (!roleRequiresSector(user.role) && hasSector) {
    context.addIssue({
      code: "custom",
      path: ["sectorId"],
      message: "Only attendants and managers may be associated with a sector.",
    });
  }
}

export const userProfileInputSchema = z
  .object({
    role: userRoleSchema,
    sectorId: sectorAssignmentSchema,
  })
  .strict()
  .superRefine(validateUserRoleSector)
  .transform((user) => ({
    ...user,
    sectorId: user.sectorId ?? null,
  }));

export const userCreationInputSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    password: z.string().min(1),
    role: userRoleSchema,
    sectorId: sectorAssignmentSchema,
  })
  .strict()
  .superRefine(validateUserRoleSector)
  .transform((user) => ({
    ...user,
    sectorId: user.sectorId ?? null,
  }));

export const userUpdateInputSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    password: z.string().min(1).optional(),
    role: userRoleSchema,
    sectorId: sectorAssignmentSchema,
  })
  .strict()
  .superRefine(validateUserRoleSector)
  .transform((user) => ({
    ...user,
    sectorId: user.sectorId ?? null,
  }));

export type UserProfileInput = z.output<typeof userProfileInputSchema>;
export type UserCreationInput = z.output<typeof userCreationInputSchema>;
export type UserUpdateInput = z.output<typeof userUpdateInputSchema>;
