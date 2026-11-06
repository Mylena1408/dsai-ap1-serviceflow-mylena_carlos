import { authenticateApiRequest } from "@/modules/api-tokens";
import type { ApiCaller } from "@/modules/public-api";
import { runAsApiUser } from "@/server/auth";
import { handleMessage, type McpAnswer } from "../application/handle-message";
import {
  JSON_RPC_ERROR,
  errorMessage,
  parseMessage,
  protocolFailure,
  resolveEra,
  type JsonObject,
  type ProtocolFailure,
} from "../domain/protocol";
import { createMcpToolOperations, type McpInfrastructure } from "./operations";

// Streamable HTTP side of the MCP endpoint (SPEC 2026-11-05-mcp-documentos, 5.1 and 5.2): one
// JSON-RPC message per POST, JSON answers only, no session, no CORS. The API token is the only
// credential; cookies are never read.

export const MAX_MCP_BODY_BYTES = 64 * 1024;

const BASE_HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } as const;

function json(body: JsonObject, status: number, extraHeaders: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...BASE_HEADERS, ...extraHeaders } });
}

function failureResponse(failure: ProtocolFailure, extraHeaders: Record<string, string> = {}): Response {
  return json(errorMessage(failure), failure.httpStatus, extraHeaders);
}

function transportFailure(status: number, message: string, extraHeaders: Record<string, string> = {}): Response {
  return failureResponse(protocolFailure(status, JSON_RPC_ERROR.INVALID_REQUEST, message), extraHeaders);
}

function answerResponse(answer: McpAnswer): Response {
  if (!("body" in answer)) return new Response(null, { status: 202, headers: BASE_HEADERS });
  return json(answer.body, answer.status);
}

/** GET and DELETE belong to the older session transport, which this server does not offer (5.2 item 1). */
export function methodNotAllowed(): Response {
  return transportFailure(405, "Only POST is supported.", { Allow: "POST" });
}

/** An `Origin` from another site is refused, against DNS rebinding (5.2 item 4). */
function foreignOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  try {
    return new URL(origin).origin !== new URL(request.url).origin;
  } catch {
    return true;
  }
}

function isJsonContentType(value: string | null): boolean {
  return value !== null && /^application\/json\s*(;|$)/i.test(value.trim());
}

/** Without `Accept` anything goes; with it, JSON (or a wildcard) must be accepted (5.2 item 3). */
function acceptsJson(value: string | null): boolean {
  if (value === null || value.trim() === "") return true;
  return value
    .split(",")
    .map((part) => part.split(";")[0].trim().toLowerCase())
    .some((type) => type === "application/json" || type === "application/*" || type === "*/*");
}

async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_MCP_BODY_BYTES) return null;
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_MCP_BODY_BYTES) return null;
  return new TextDecoder().decode(bytes);
}

async function authenticate(request: Request, database: McpInfrastructure["database"], now: Date) {
  // Every tool only reads, so a READ token is enough: the scope check is the one of a GET (5.1 item 3).
  return authenticateApiRequest({ headers: request.headers, method: "GET" }, database, now);
}

export async function handleMcpPost(request: Request, infrastructure: McpInfrastructure): Promise<Response> {
  if (foreignOrigin(request)) return transportFailure(403, "Origin not allowed.");
  if (!isJsonContentType(request.headers.get("content-type"))) return transportFailure(415, "Content-Type must be application/json.");
  if (!acceptsJson(request.headers.get("accept"))) return transportFailure(406, "The answer is application/json.");

  const now = new Date();
  const authentication = await authenticate(request, infrastructure.database, now);
  if (!authentication.ok) {
    if (authentication.error === "rate_limited") {
      return failureResponse(protocolFailure(429, JSON_RPC_ERROR.RATE_LIMITED, "Rate limit exceeded."), {
        "Retry-After": String(authentication.retryAfterSeconds),
      });
    }
    if (authentication.error === "insufficient_scope") {
      return failureResponse(protocolFailure(403, JSON_RPC_ERROR.UNAUTHORIZED, "Insufficient scope."));
    }
    return failureResponse(protocolFailure(401, JSON_RPC_ERROR.UNAUTHORIZED, "Invalid or missing token."), {
      "WWW-Authenticate": "Bearer",
    });
  }

  const text = await readBody(request);
  if (text === null) return transportFailure(413, "Request body too large.");

  const parsed = parseMessage(text);
  if (!parsed.ok) return failureResponse(parsed.failure);

  const era = resolveEra(parsed.value, (name) => request.headers.get(name));
  if (!era.ok) return failureResponse(era.failure);

  const caller: ApiCaller = {
    user: authentication.user,
    scope: authentication.scope,
    expiresAt: authentication.expiresAt,
    sectorName: authentication.sectorName,
  };
  const operations = createMcpToolOperations(caller, now, infrastructure);
  const answer = await runAsApiUser(caller.user, () =>
    handleMessage(parsed.value, era.value, { role: caller.user.role }, operations),
  );
  return answerResponse(answer);
}
