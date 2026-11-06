// MCP protocol rules (SPEC 2026-11-05-mcp-documentos, 5.2 and 5.3). Pure functions over a parsed
// JSON-RPC message and the request headers: no I/O, no framework. The server is "dual-era": it
// serves modern requests (revision 2026-07-28, per-request `_meta`) and clients of the revisions
// that open with `initialize` (2025-03-26 to 2025-11-25), always without a session.

export const MODERN_PROTOCOL_VERSION = "2026-07-28";
export const LEGACY_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [MODERN_PROTOCOL_VERSION, ...LEGACY_PROTOCOL_VERSIONS];
/** Clients older than 2025-06-18 send no version header; the transport rules assume 2025-03-26. */
export const HEADERLESS_LEGACY_VERSION = "2025-03-26";

export const PROTOCOL_VERSION_META = "io.modelcontextprotocol/protocolVersion";

export const JSON_RPC_ERROR = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  /** Implementation-defined server errors (JSON-RPC reserves -32000 to -32099 for them). */
  UNAUTHORIZED: -32001,
  RATE_LIMITED: -32003,
  /** Protocol-defined by MCP 2026-07-28. */
  HEADER_MISMATCH: -32020,
  UNSUPPORTED_PROTOCOL_VERSION: -32022,
} as const;

export type JsonRpcId = string | number;
export type JsonObject = Record<string, unknown>;

export type McpMessage =
  | { kind: "request"; id: JsonRpcId; method: string; params: JsonObject }
  | { kind: "notification"; method: string; params: JsonObject };

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

/** A refusal at the protocol level: the HTTP status and the JSON-RPC error to answer with. */
export interface ProtocolFailure {
  httpStatus: number;
  id: JsonRpcId | null;
  error: JsonRpcErrorObject;
}

export type Era = { kind: "modern"; version: string } | { kind: "legacy"; version: string };

export type Outcome<T> = { ok: true; value: T } | { ok: false; failure: ProtocolFailure };

/** Reads one header by name, case-insensitively (the `Headers.get` contract). */
export type HeaderReader = (name: string) => string | null;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidId(value: unknown): value is JsonRpcId {
  return (typeof value === "string" && value.length > 0) || (typeof value === "number" && Number.isInteger(value));
}

export function protocolFailure(
  httpStatus: number,
  code: number,
  message: string,
  id: JsonRpcId | null = null,
  data?: unknown,
): ProtocolFailure {
  return { httpStatus, id, error: data === undefined ? { code, message } : { code, message, data } };
}

function invalidRequest(message: string, id: JsonRpcId | null = null): Outcome<never> {
  return { ok: false, failure: protocolFailure(400, JSON_RPC_ERROR.INVALID_REQUEST, message, id) };
}

/**
 * Parses the POST body into a single JSON-RPC request or notification (5.2 item 5). Batches,
 * responses sent by the client, a `null` id and params that are not an object are refused.
 */
export function parseMessage(text: string): Outcome<McpMessage> {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, failure: protocolFailure(400, JSON_RPC_ERROR.PARSE_ERROR, "Parse error.") };
  }

  if (Array.isArray(body)) return invalidRequest("Batches are not supported.");
  if (!isObject(body) || body.jsonrpc !== "2.0") return invalidRequest("Invalid JSON-RPC message.");

  const id = "id" in body ? body.id : undefined;
  const echoId = isValidId(id) ? id : null;

  if ("result" in body || "error" in body) return invalidRequest("Clients must not send responses.", echoId);
  if (typeof body.method !== "string" || body.method.length === 0) return invalidRequest("Missing method.", echoId);
  if (body.params !== undefined && !isObject(body.params)) return invalidRequest("Params must be an object.", echoId);

  const params = (body.params as JsonObject | undefined) ?? {};
  if (id === undefined) return { ok: true, value: { kind: "notification", method: body.method, params } };
  if (!isValidId(id)) return invalidRequest("Invalid request id.");

  return { ok: true, value: { kind: "request", id, method: body.method, params } };
}

const BASE64_SENTINEL = /^=\?base64\?([A-Za-z0-9+/]*={0,2})\?=$/;

/**
 * Decodes a mirrored header value: `=?base64?…?=` carries UTF-8 in Base64 (transport rules,
 * "Value Encoding"); any other value is used as it is. A sentinel that is not valid Base64 or
 * not valid UTF-8 gives `null`, which never matches a body value.
 */
export function decodeHeaderValue(value: string): string | null {
  if (!value.startsWith("=?base64?")) return value;
  const match = BASE64_SENTINEL.exec(value);
  if (!match || match[1].length % 4 !== 0) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(match[1], "base64"));
  } catch {
    return null;
  }
}

function metaVersion(params: JsonObject): unknown {
  const meta = params._meta;
  return isObject(meta) ? meta[PROTOCOL_VERSION_META] : undefined;
}

function headerMismatch(message: string, id: JsonRpcId | null): Outcome<never> {
  return { ok: false, failure: protocolFailure(400, JSON_RPC_ERROR.HEADER_MISMATCH, message, id) };
}

function unsupportedVersion(requested: string, id: JsonRpcId | null): Outcome<never> {
  return {
    ok: false,
    failure: protocolFailure(400, JSON_RPC_ERROR.UNSUPPORTED_PROTOCOL_VERSION, "Unsupported protocol version", id, {
      supported: SUPPORTED_PROTOCOL_VERSIONS,
      requested,
    }),
  };
}

function isLegacyVersion(version: string): boolean {
  return (LEGACY_PROTOCOL_VERSIONS as readonly string[]).includes(version);
}

/** Methods whose name or URI the modern transport mirrors into `Mcp-Name`. */
const NAMED_METHODS: Record<string, string> = { "tools/call": "name", "resources/read": "uri", "prompts/get": "name" };

/**
 * Decides which era a message belongs to and checks the version and the mirrored headers
 * (5.3 items 2 to 4). A modern request must repeat its `_meta` version in `MCP-Protocol-Version`,
 * its method in `Mcp-Method` and, for named methods, the name in `Mcp-Name`.
 */
export function resolveEra(message: McpMessage, header: HeaderReader): Outcome<Era> {
  const id = message.kind === "request" ? message.id : null;
  const declared = metaVersion(message.params);
  const versionHeader = header("mcp-protocol-version");

  if (declared !== undefined) {
    if (message.method === "initialize") {
      return headerMismatch("initialize cannot carry modern request metadata.", id);
    }
    if (typeof declared !== "string" || declared.length === 0) {
      return { ok: false, failure: protocolFailure(400, JSON_RPC_ERROR.INVALID_PARAMS, "Invalid protocol version metadata.", id) };
    }
    if (versionHeader === null) return headerMismatch("Missing MCP-Protocol-Version header.", id);
    if (versionHeader !== declared) return headerMismatch("MCP-Protocol-Version header does not match the body.", id);
    if (declared !== MODERN_PROTOCOL_VERSION) return unsupportedVersion(declared, id);

    const methodHeader = header("mcp-method");
    if (methodHeader === null) return headerMismatch("Missing Mcp-Method header.", id);
    if (methodHeader !== message.method) return headerMismatch("Mcp-Method header does not match the body.", id);

    const nameField = NAMED_METHODS[message.method];
    if (nameField !== undefined) {
      const nameHeader = header("mcp-name");
      if (nameHeader === null) return headerMismatch("Missing Mcp-Name header.", id);
      if (decodeHeaderValue(nameHeader) !== message.params[nameField]) {
        return headerMismatch("Mcp-Name header does not match the body.", id);
      }
    }

    return { ok: true, value: { kind: "modern", version: declared } };
  }

  // `initialize` precedes the negotiation, so its version comes from the body, not the header.
  if (message.method === "initialize") return { ok: true, value: { kind: "legacy", version: negotiateLegacyVersion(message.params) } };
  if (versionHeader === null) return { ok: true, value: { kind: "legacy", version: HEADERLESS_LEGACY_VERSION } };
  if (isLegacyVersion(versionHeader)) return { ok: true, value: { kind: "legacy", version: versionHeader } };
  // A modern version in the header with no `_meta` in the body: the header has no body value to match.
  if (versionHeader === MODERN_PROTOCOL_VERSION) return headerMismatch("Modern requests must carry _meta.", id);
  return unsupportedVersion(versionHeader, id);
}

/** The version answered to `initialize`: the one asked for, if supported, or the newest legacy one. */
export function negotiateLegacyVersion(params: JsonObject): string {
  const requested = params.protocolVersion;
  return typeof requested === "string" && isLegacyVersion(requested) ? requested : LEGACY_PROTOCOL_VERSIONS[0];
}

export const SERVER_INFO = { name: "serviceflow", title: "ServiceFlow", version: "0.1.0" } as const;

export const SERVER_INSTRUCTIONS =
  "ServiceFlow request documents. Use find_requests to locate a request, list_request_documents to see " +
  "its documents and comment files, then read_request_document or read_comment_file to read one. Every " +
  "tool is read-only and returns only what the token owner can already see in ServiceFlow.";

const CAPABILITIES = { tools: { listChanged: false } } as const;

/** Adds `resultType` to modern results; legacy revisions do not define it. */
export function completeResult(era: Era, result: JsonObject): JsonObject {
  return era.kind === "modern" ? { resultType: "complete", ...result } : result;
}

export function discoverResult(era: Era): JsonObject {
  return completeResult(era, {
    supportedVersions: SUPPORTED_PROTOCOL_VERSIONS,
    capabilities: CAPABILITIES,
    _meta: { "io.modelcontextprotocol/serverInfo": SERVER_INFO },
    instructions: SERVER_INSTRUCTIONS,
  });
}

export function initializeResult(version: string): JsonObject {
  return { protocolVersion: version, capabilities: CAPABILITIES, serverInfo: SERVER_INFO, instructions: SERVER_INSTRUCTIONS };
}

export function successMessage(id: JsonRpcId, result: JsonObject): JsonObject {
  return { jsonrpc: "2.0", id, result };
}

/** Error message; without a request id the `id` member is left out, as the transport rules ask. */
export function errorMessage(failure: Pick<ProtocolFailure, "id" | "error">): JsonObject {
  return failure.id === null ? { jsonrpc: "2.0", error: failure.error } : { jsonrpc: "2.0", id: failure.id, error: failure.error };
}
