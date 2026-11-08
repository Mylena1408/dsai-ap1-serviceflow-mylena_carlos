// Sectors' tags (SPEC 2026-11-08-atendimento-dia-a-dia, part A). The configuration's use cases arrive in
// SF-195 and the request's in SF-196; this is the public API of the rules.
export {
  MAX_ACTIVE_TAGS_PER_SECTOR,
  MAX_TAGS_PER_REQUEST,
  MAX_TAG_NAME_LENGTH,
  TAG_COLORS,
  TAG_COLOR_KEYS,
  assertTagRoom,
  canManageSectorTags,
  contrastRatio,
  planTagChange,
  tagInputSchema,
  type TagActor,
  type TagColor,
  type TagInput,
  type TagRecord,
  type TaggableRequest,
} from "./domain/tag";
