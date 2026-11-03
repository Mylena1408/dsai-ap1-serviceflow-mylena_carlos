import * as endpoints from "./application/endpoints";
import { OPENAPI_DOCUMENT } from "./domain/openapi";
import { apiJson, handleApiCall, jsonBody, optionalJsonBody } from "./infrastructure/http";

// Public API of the /api/v1 module (SPEC 2026-11-02-api-externa-webhooks, 5.3 and 5.4). The route
// files only point at these handlers.
export { API_ERROR_CODES, API_ERROR_STATUS, apiErrorBody, apiErrorCodeFor } from "./domain/errors";
export type { ApiErrorBody, ApiErrorCode } from "./domain/errors";
export { API_V1_OPERATIONS, OPENAPI_DOCUMENT } from "./domain/openapi";
export type { ApiOperation } from "./domain/openapi";

type RequestRouteContext = { params: Promise<{ requestId: string }> };

function query(request: Request): endpoints.RawQuery {
  const params = new URL(request.url).searchParams;
  const result: endpoints.RawQuery = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    result[key] = values.length > 1 ? values : values[0];
  }
  return result;
}

export function getMe(request: Request): Promise<Response> {
  return handleApiCall(request, (caller) => endpoints.me(caller));
}

export function getServices(request: Request): Promise<Response> {
  return handleApiCall(request, (caller) => endpoints.services(caller));
}

export function getRequests(request: Request): Promise<Response> {
  return handleApiCall(request, (caller, now) => endpoints.listRequests(caller, query(request), now));
}

export function postRequest(request: Request): Promise<Response> {
  return handleApiCall(request, async (caller, now) => endpoints.openRequest(caller, await jsonBody(request), now));
}

export async function getRequest(request: Request, { params }: RequestRouteContext): Promise<Response> {
  const { requestId } = await params;
  return handleApiCall(request, (caller, now) => endpoints.getRequest(caller, requestId, now));
}

export async function postComment(request: Request, { params }: RequestRouteContext): Promise<Response> {
  const { requestId } = await params;
  return handleApiCall(request, async (caller) => endpoints.commentOnRequest(caller, requestId, await jsonBody(request)));
}

function action(name: endpoints.RequestAction) {
  return async (request: Request, { params }: RequestRouteContext): Promise<Response> => {
    const { requestId } = await params;
    return handleApiCall(request, async (caller, now) =>
      endpoints.runRequestAction(caller, requestId, name, await optionalJsonBody(request), now),
    );
  };
}

// SPEC 2026-11-03-api-acoes-webhooks-setor, 5.1 (decision W1).
export const postStart = action("start");
export const postComplete = action("complete");
export const postAssume = action("assume");
export const postRelease = action("release");
export const postTransfer = action("transfer");
export const postCancel = action("cancel");
export const postReopen = action("reopen");

export async function getTransferCandidates(request: Request, { params }: RequestRouteContext): Promise<Response> {
  const { requestId } = await params;
  return handleApiCall(request, (caller) => endpoints.transferCandidates(caller, requestId));
}

// SPEC 2026-11-03-transferencia-entre-setores, 5.8.
export async function postTransferSector(request: Request, { params }: RequestRouteContext): Promise<Response> {
  const { requestId } = await params;
  return handleApiCall(request, async (caller) => endpoints.sendToSector(caller, requestId, await jsonBody(request)));
}

export async function getSectorCandidates(request: Request, { params }: RequestRouteContext): Promise<Response> {
  const { requestId } = await params;
  return handleApiCall(request, (caller) => endpoints.sectorCandidates(caller, requestId));
}

/** Public, without token (5.4). */
export function getOpenApiDocument(): Response {
  return apiJson(OPENAPI_DOCUMENT);
}
