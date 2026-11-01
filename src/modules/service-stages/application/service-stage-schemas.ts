import { z } from "zod";
import { nonEmptyTextSchema } from "@/shared/validation";
import { MAX_STAGE_NAME_LENGTH } from "../domain/service-stage";

// SPEC 2026-11-01-fluxos-configuraveis, section 5.1: only the name comes from input; service,
// position and state are decided on the server.
export const serviceStageInputSchema = z
  .object({
    name: nonEmptyTextSchema.max(MAX_STAGE_NAME_LENGTH),
  })
  .strict();

export const serviceStageMoveSchema = z.enum(["up", "down"]);

export type ServiceStageInput = z.output<typeof serviceStageInputSchema>;
