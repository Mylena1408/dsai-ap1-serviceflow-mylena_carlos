import { z } from "zod";

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

export type OwnPasswordChangeInput = z.output<typeof ownPasswordChangeInputSchema>;
