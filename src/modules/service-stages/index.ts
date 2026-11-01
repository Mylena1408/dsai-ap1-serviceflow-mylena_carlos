// Public API of the attendance flow module (SPEC 2026-11-01-fluxos-configuraveis).
// SF-076 exposes the rules; the use cases and the repository come with SF-077.

export {
  MAX_ACTIVE_SERVICE_STAGES,
  MAX_STAGE_NAME_LENGTH,
  assertCanAddActiveStage,
  assertStageNameAvailable,
} from "./domain/service-stage";
export type { ServiceStageRecord } from "./domain/service-stage";
export { serviceStageInputSchema } from "./application/service-stage-schemas";
export type { ServiceStageInput } from "./application/service-stage-schemas";
