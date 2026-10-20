import { z } from "zod";

const nonEmptyTextSchema = z.string().trim().min(1);
const uuidSchema = z.uuid();
const userRoleSchema = z.enum(["ADMIN", "REQUESTER", "ATTENDANT"]);
const sectorAssignmentSchema = uuidSchema.nullable().optional();

function validateUserRoleSector(
  user: { role: z.infer<typeof userRoleSchema>; sectorId?: string | null },
  context: z.RefinementCtx,
): void {
  const hasSector = user.sectorId !== undefined && user.sectorId !== null;

  if (user.role === "ATTENDANT" && !hasSector) {
    context.addIssue({
      code: "custom",
      path: ["sectorId"],
      message: "Attendants require a sector.",
    });
  }

  if (user.role !== "ATTENDANT" && hasSector) {
    context.addIssue({
      code: "custom",
      path: ["sectorId"],
      message: "Only attendants may be associated with a sector.",
    });
  }
}

export const nameSchema = nonEmptyTextSchema;
export const entityIdSchema = uuidSchema;
export const activeStateSchema = z.boolean();
export const activeStateInputSchema = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

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

export const ownPasswordChangeInputSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(12),
    confirmPassword: z.string().min(12),
  })
  .strict()
  .refine((input) => input.newPassword === input.confirmPassword, {
    path: ["confirmPassword"],
    message: "Confirmation does not match the new password.",
  });

export const sectorInputSchema = z
  .object({
    name: nameSchema,
  })
  .strict();

export const categoryInputSchema = z
  .object({
    name: nameSchema,
  })
  .strict();

export const serviceInputSchema = z
  .object({
    name: nameSchema,
    description: nonEmptyTextSchema,
    categoryId: uuidSchema,
    sectorId: uuidSchema,
  })
  .strict();

export const documentFormatSchema = z.enum(["PDF", "DOCX", "TXT"]);

// SPEC 21.2: name up to 120 characters, required/optional flag and a non-empty
// subset of PDF, DOCX and TXT. Service, position and state never come from input.
export const documentRequirementInputSchema = z
  .object({
    name: nonEmptyTextSchema.max(120),
    isRequired: z.boolean(),
    acceptedFormats: z
      .array(documentFormatSchema)
      .min(1)
      .max(3)
      .refine((formats) => new Set(formats).size === formats.length, {
        message: "Accepted formats must not repeat.",
      }),
  })
  .strict();

export const documentRequirementMoveSchema = z.enum(["up", "down"]);

export const requestCreationInputSchema = z
  .object({
    serviceId: uuidSchema,
    description: nonEmptyTextSchema.max(10_000),
  })
  .strict();

export const requestStatusTransitionInputSchema = z
  .object({
    requestId: uuidSchema,
    toStatus: z.enum(["IN_PROGRESS", "COMPLETED"]),
  })
  .strict();

export type UserProfileInput = z.output<typeof userProfileInputSchema>;
export type UserCreationInput = z.output<typeof userCreationInputSchema>;
export type UserUpdateInput = z.output<typeof userUpdateInputSchema>;
export type OwnPasswordChangeInput = z.output<typeof ownPasswordChangeInputSchema>;
export type SectorInput = z.output<typeof sectorInputSchema>;
export type CategoryInput = z.output<typeof categoryInputSchema>;
export type ServiceInput = z.output<typeof serviceInputSchema>;
export type DocumentRequirementInput = z.output<typeof documentRequirementInputSchema>;
export type DocumentRequirementMove = z.output<typeof documentRequirementMoveSchema>;
export type RequestCreationInput = z.output<typeof requestCreationInputSchema>;
export type RequestStatusTransitionInput = z.output<
  typeof requestStatusTransitionInputSchema
>;
