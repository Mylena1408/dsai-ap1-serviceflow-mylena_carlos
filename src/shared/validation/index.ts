import { z } from "zod";

// Generic schemas shared by several modules (SPEC 2026-10-27, section 8). Schemas of a
// single domain live in that module's application/ layer.

export const nonEmptyTextSchema = z.string().trim().min(1);
export const nameSchema = nonEmptyTextSchema;
export const entityIdSchema = z.uuid();
export const activeStateSchema = z.boolean();
export const activeStateInputSchema = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email());
