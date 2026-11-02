// Public API of the API tokens module (SPEC 2026-11-02-api-externa-webhooks). SF-111 brings the
// rules; use cases, authentication and pages come in SF-112.
export {
  API_TOKEN_OWNER_ROLES,
  API_TOKEN_PREFIX,
  API_TOKEN_SCOPE_LABELS,
  API_TOKEN_SCOPES,
  API_TOKEN_VALIDITY_DAYS,
  DEFAULT_API_TOKEN_VALIDITY_DAYS,
  MAX_ACTIVE_API_TOKENS,
  apiTokenAllows,
  apiTokenCreationRefusal,
  apiTokenExpiry,
  bearerApiToken,
  canAuthenticateWithApiToken,
  generateApiToken,
  hashApiToken,
  isApiTokenActive,
  isApiTokenValidityDays,
  normalizeApiTokenName,
  shouldRecordApiTokenUse,
} from "./domain/token";
export type {
  ApiTokenCreationRefusal,
  ApiTokenScope,
  ApiTokenValidityDays,
  GeneratedApiToken,
} from "./domain/token";
export { API_CALLS_PER_MINUTE, RATE_WINDOW_RETENTION_MS, rateDecision, rateWindowStart } from "./domain/rate-limit";
export type { RateDecision } from "./domain/rate-limit";
