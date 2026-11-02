// Error answers of /api/v1 (SPEC 2026-11-02-api-externa-webhooks, 5.4): one body format, fixed codes
// and messages, never a stack, SQL or data of another person.

export const API_ERROR_CODES = [
  "invalid_request",
  "invalid_token",
  "forbidden",
  "insufficient_scope",
  "not_found",
  "conflict",
  "documents_required",
  "rate_limited",
  "internal_error",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const API_ERROR_STATUS: Record<ApiErrorCode, number> = {
  invalid_request: 400,
  invalid_token: 401,
  forbidden: 403,
  insufficient_scope: 403,
  not_found: 404,
  conflict: 409,
  documents_required: 422,
  rate_limited: 429,
  internal_error: 500,
};

export const API_ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  invalid_request: "The request is invalid.",
  invalid_token: "The token is missing, invalid, expired or revoked.",
  forbidden: "Your profile cannot use this operation.",
  insufficient_scope: "This token is read-only.",
  not_found: "The resource was not found.",
  conflict: "The request conflicts with the current state.",
  documents_required: "This service requires documents; open it in ServiceFlow.",
  rate_limited: "Too many calls with this token; wait and try again.",
  internal_error: "An unexpected error occurred.",
};

/** One problem of an invalid request: a public field path and a fixed code, never the sent value. */
export interface ApiIssue {
  path: string[];
  code: string;
}

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    /** Only for `invalid_request`: which fields were refused and why. */
    issues?: ApiIssue[];
    /** Only for refused custom field answers: field ids and codes, as on the screen. */
    fields?: Array<{ fieldId: string; code: string }>;
  };
}

export function apiErrorBody(
  code: ApiErrorCode,
  details: { issues?: ApiIssue[]; fields?: Array<{ fieldId: string; code: string }> } = {},
): ApiErrorBody {
  return {
    error: {
      code,
      message: API_ERROR_MESSAGES[code],
      ...(details.issues?.length ? { issues: details.issues } : {}),
      ...(details.fields?.length ? { fields: details.fields } : {}),
    },
  };
}

/** Error codes of the application (src/server/errors) translated to the API ones. */
export function apiErrorCodeFor(applicationCode: string): ApiErrorCode {
  switch (applicationCode) {
    case "VALIDATION_ERROR":
      return "invalid_request";
    case "UNAUTHENTICATED":
      return "invalid_token";
    case "FORBIDDEN":
      return "forbidden";
    case "NOT_FOUND":
      return "not_found";
    case "CONFLICT":
      return "conflict";
    default:
      return "internal_error";
  }
}
