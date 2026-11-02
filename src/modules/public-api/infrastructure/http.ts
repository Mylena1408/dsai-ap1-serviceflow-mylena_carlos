import { authenticateApiRequest } from "@/modules/api-tokens";
import { FieldAnswersError } from "@/modules/service-fields";
import { runAsApiUser } from "@/server/auth";
import { ApplicationError, ValidationError, toErrorResponse } from "@/server/errors";
import { scheduleEventProcessing } from "@/server/jobs/schedule";
import { API_ERROR_STATUS, apiErrorBody, apiErrorCodeFor, type ApiErrorCode, type ApiIssue } from "../domain/errors";
import { ApiRefusal, type ApiCaller, type ApiResult } from "../application/endpoints";

// HTTP side of /api/v1 (SPEC 2026-11-02-api-externa-webhooks, 5.3 and 5.4): the token in the
// `Authorization` header is the only credential (cookies are never read), every answer is JSON with
// `no-store` and `nosniff`, and there is no CORS: the API is for servers, not for other sites.

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } as const;

export function apiJson(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...HEADERS, ...extraHeaders } });
}

function apiError(code: ApiErrorCode, details: Parameters<typeof apiErrorBody>[1] = {}, headers: Record<string, string> = {}): Response {
  return apiJson(apiErrorBody(code, details), API_ERROR_STATUS[code], headers);
}

function errorAnswer(error: unknown): Response {
  if (error instanceof ApiRefusal) return apiError(error.code);
  if (error instanceof FieldAnswersError) {
    // "stale_form" (an answer to a field the service no longer has) carries no field list.
    return apiError("invalid_request", {
      fields: error.fieldErrors.map(({ fieldId, code }) => ({ fieldId, code })),
      issues: error.fieldErrors.length === 0 ? [{ path: ["fields"], code: "custom" }] : undefined,
    });
  }
  if (error instanceof ApplicationError) {
    // Paths and codes go through the same public filter as the rest of the application.
    const issues = error instanceof ValidationError ? (toErrorResponse(error).body.error.issues as ApiIssue[] | undefined) : undefined;
    return apiError(apiErrorCodeFor(error.code), { issues });
  }
  console.error("Unexpected error in /api/v1.", error instanceof Error ? error.name : "unknown");
  return apiError("internal_error");
}

/** JSON body of a POST: anything that does not parse is an invalid request. */
export async function jsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ValidationError([{ path: [], code: "invalid_format" }]);
  }
}

/**
 * Authenticates the call, then runs `operation` with the token owner as the user of every use
 * case. Refusals of the token come before anything else is read.
 */
export async function handleApiCall(
  request: Request,
  operation: (caller: ApiCaller, now: Date) => Promise<ApiResult>,
): Promise<Response> {
  const now = new Date();
  const authentication = await authenticateApiRequest(request, undefined, now);

  if (!authentication.ok) {
    if (authentication.error === "rate_limited") {
      return apiError("rate_limited", {}, { "Retry-After": String(authentication.retryAfterSeconds) });
    }
    return apiError(authentication.error, {}, authentication.error === "invalid_token" ? { "WWW-Authenticate": "Bearer" } : {});
  }

  const caller: ApiCaller = {
    user: authentication.user,
    scope: authentication.scope,
    expiresAt: authentication.expiresAt,
    sectorName: authentication.sectorName,
  };

  try {
    const result = await runAsApiUser(caller.user, () => operation(caller, now));
    // Notifications and webhooks of what the call recorded go out right after the answer.
    if (result.recordedEvents) scheduleEventProcessing();
    return apiJson(result.body, result.status);
  } catch (error) {
    return errorAnswer(error);
  }
}
