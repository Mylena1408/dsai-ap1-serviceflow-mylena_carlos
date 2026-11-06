import { describe, expect, it } from "vitest";
import {
  HEADERLESS_LEGACY_VERSION,
  JSON_RPC_ERROR,
  LEGACY_PROTOCOL_VERSIONS,
  MODERN_PROTOCOL_VERSION,
  PROTOCOL_VERSION_META,
  SERVER_INFO,
  SUPPORTED_PROTOCOL_VERSIONS,
  completeResult,
  decodeHeaderValue,
  discoverResult,
  errorMessage,
  initializeResult,
  negotiateLegacyVersion,
  parseMessage,
  resolveEra,
  successMessage,
  type McpMessage,
} from "@/modules/mcp/domain/protocol";

// SPEC 2026-11-05-mcp-documentos, 5.2 and 5.3 (SF-138).

function headers(values: Record<string, string> = {}) {
  const map = new Headers(values);
  return (name: string) => map.get(name);
}

function parsed(body: unknown): McpMessage {
  const outcome = parseMessage(JSON.stringify(body));
  if (!outcome.ok) throw new Error(`expected a valid message, got ${outcome.failure.error.message}`);
  return outcome.value;
}

const modernMeta = { _meta: { [PROTOCOL_VERSION_META]: MODERN_PROTOCOL_VERSION } };

function modernCall(name = "list_request_documents") {
  return parsed({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: {}, ...modernMeta } });
}

const modernHeaders = (extra: Record<string, string> = {}) =>
  headers({ "MCP-Protocol-Version": MODERN_PROTOCOL_VERSION, "Mcp-Method": "tools/call", "Mcp-Name": "list_request_documents", ...extra });

describe("parseMessage (5.2 item 5)", () => {
  it("reads a request with a numeric or string id and object params", () => {
    expect(parsed({ jsonrpc: "2.0", id: 1, method: "ping" })).toEqual({ kind: "request", id: 1, method: "ping", params: {} });
    expect(parsed({ jsonrpc: "2.0", id: "a", method: "tools/list", params: { cursor: "x" } })).toEqual({
      kind: "request",
      id: "a",
      method: "tools/list",
      params: { cursor: "x" },
    });
  });

  it("reads a message without id as a notification", () => {
    expect(parsed({ jsonrpc: "2.0", method: "notifications/initialized" })).toEqual({
      kind: "notification",
      method: "notifications/initialized",
      params: {},
    });
  });

  it("answers -32700 with status 400 to a body that is not JSON", () => {
    const outcome = parseMessage("{not json");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure).toMatchObject({ httpStatus: 400, id: null, error: { code: JSON_RPC_ERROR.PARSE_ERROR } });
  });

  it.each([
    ["a batch", [{ jsonrpc: "2.0", id: 1, method: "ping" }]],
    ["a primitive", 42],
    ["null", null],
    ["a wrong jsonrpc version", { jsonrpc: "1.0", id: 1, method: "ping" }],
    ["no jsonrpc member", { id: 1, method: "ping" }],
    ["an empty method", { jsonrpc: "2.0", id: 1, method: "" }],
    ["a numeric method", { jsonrpc: "2.0", id: 1, method: 3 }],
    ["array params", { jsonrpc: "2.0", id: 1, method: "ping", params: [] }],
    ["string params", { jsonrpc: "2.0", id: 1, method: "ping", params: "x" }],
    ["a null id", { jsonrpc: "2.0", id: null, method: "ping" }],
    ["an empty string id", { jsonrpc: "2.0", id: "", method: "ping" }],
    ["a fractional id", { jsonrpc: "2.0", id: 1.5, method: "ping" }],
    ["an object id", { jsonrpc: "2.0", id: {}, method: "ping" }],
    ["a response sent by the client", { jsonrpc: "2.0", id: 1, result: {} }],
    ["an error sent by the client", { jsonrpc: "2.0", id: 1, error: { code: 1, message: "x" } }],
  ])("refuses %s with -32600 and status 400", (_case, body) => {
    const outcome = parseMessage(JSON.stringify(body));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.httpStatus).toBe(400);
    expect(outcome.failure.error.code).toBe(JSON_RPC_ERROR.INVALID_REQUEST);
  });

  it("echoes a valid id when the rest of the message is invalid", () => {
    const outcome = parseMessage(JSON.stringify({ jsonrpc: "2.0", id: 9, method: "ping", params: [] }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.id).toBe(9);
  });

  it("does not echo an invalid id", () => {
    const outcome = parseMessage(JSON.stringify({ jsonrpc: "2.0", id: { x: 1 }, result: {} }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.id).toBeNull();
  });
});

describe("decodeHeaderValue (transport, Value Encoding)", () => {
  it("returns a plain value as it is", () => {
    expect(decodeHeaderValue("read_comment_file")).toBe("read_comment_file");
    expect(decodeHeaderValue("")).toBe("");
  });

  it("decodes the base64 sentinel as UTF-8", () => {
    const encoded = `=?base64?${Buffer.from("Olá, mundo").toString("base64")}?=`;
    expect(decodeHeaderValue(encoded)).toBe("Olá, mundo");
  });

  it("decodes a sentinel that wraps a value which itself looks like a sentinel", () => {
    expect(decodeHeaderValue("=?base64?PT9iYXNlNjQ/bGl0ZXJhbD89?=")).toBe("=?base64?literal?=");
  });

  it.each([
    ["characters outside base64", "=?base64?no spaces!?="],
    ["a length that is not a multiple of 4", "=?base64?abc?="],
    ["a missing suffix", "=?base64?YWJj"],
    ["bytes that are not UTF-8", `=?base64?${Buffer.from([0xff, 0xfe, 0xfd]).toString("base64")}?=`],
  ])("gives null for %s", (_case, value) => {
    expect(decodeHeaderValue(value)).toBeNull();
  });
});

describe("resolveEra: modern requests (5.3 item 2)", () => {
  it("accepts a modern request whose headers repeat the body", () => {
    expect(resolveEra(modernCall(), modernHeaders())).toEqual({ ok: true, value: { kind: "modern", version: MODERN_PROTOCOL_VERSION } });
  });

  it("compares header names case-insensitively", () => {
    const outcome = resolveEra(
      modernCall(),
      headers({ "mcp-protocol-version": MODERN_PROTOCOL_VERSION, "MCP-METHOD": "tools/call", "mcp-name": "list_request_documents" }),
    );
    expect(outcome.ok).toBe(true);
  });

  it("accepts a base64-encoded Mcp-Name that decodes to the body name", () => {
    const name = `=?base64?${Buffer.from("list_request_documents").toString("base64")}?=`;
    expect(resolveEra(modernCall(), modernHeaders({ "Mcp-Name": name })).ok).toBe(true);
  });

  it("does not ask for Mcp-Name on methods without a name", () => {
    const message = parsed({ jsonrpc: "2.0", id: 1, method: "tools/list", params: modernMeta });
    const outcome = resolveEra(message, headers({ "MCP-Protocol-Version": MODERN_PROTOCOL_VERSION, "Mcp-Method": "tools/list" }));
    expect(outcome.ok).toBe(true);
  });

  it.each([
    ["no MCP-Protocol-Version", { "Mcp-Method": "tools/call", "Mcp-Name": "list_request_documents" }],
    ["a different MCP-Protocol-Version", { "MCP-Protocol-Version": "2025-11-25", "Mcp-Method": "tools/call", "Mcp-Name": "list_request_documents" }],
    ["no Mcp-Method", { "MCP-Protocol-Version": MODERN_PROTOCOL_VERSION, "Mcp-Name": "list_request_documents" }],
    ["a different Mcp-Method", { "MCP-Protocol-Version": MODERN_PROTOCOL_VERSION, "Mcp-Method": "tools/list", "Mcp-Name": "list_request_documents" }],
    ["a method header in another case", { "MCP-Protocol-Version": MODERN_PROTOCOL_VERSION, "Mcp-Method": "TOOLS/CALL", "Mcp-Name": "list_request_documents" }],
    ["no Mcp-Name", { "MCP-Protocol-Version": MODERN_PROTOCOL_VERSION, "Mcp-Method": "tools/call" }],
    ["a different Mcp-Name", { "MCP-Protocol-Version": MODERN_PROTOCOL_VERSION, "Mcp-Method": "tools/call", "Mcp-Name": "read_comment_file" }],
    ["an undecodable Mcp-Name", { "MCP-Protocol-Version": MODERN_PROTOCOL_VERSION, "Mcp-Method": "tools/call", "Mcp-Name": "=?base64?***?=" }],
  ])("answers HeaderMismatch (-32020, 400) to %s", (_case, values) => {
    const outcome = resolveEra(modernCall(), headers(values));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure).toMatchObject({ httpStatus: 400, id: 7, error: { code: JSON_RPC_ERROR.HEADER_MISMATCH } });
  });

  it("answers -32022 with the supported versions to an unknown modern version", () => {
    const message = parsed({ jsonrpc: "2.0", id: 3, method: "tools/list", params: { _meta: { [PROTOCOL_VERSION_META]: "2030-01-01" } } });
    const outcome = resolveEra(message, headers({ "MCP-Protocol-Version": "2030-01-01", "Mcp-Method": "tools/list" }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure).toEqual({
      httpStatus: 400,
      id: 3,
      error: {
        code: JSON_RPC_ERROR.UNSUPPORTED_PROTOCOL_VERSION,
        message: "Unsupported protocol version",
        data: { supported: SUPPORTED_PROTOCOL_VERSIONS, requested: "2030-01-01" },
      },
    });
  });

  it("answers -32022 to a legacy version declared in the modern metadata", () => {
    const message = parsed({ jsonrpc: "2.0", id: 3, method: "tools/list", params: { _meta: { [PROTOCOL_VERSION_META]: "2025-11-25" } } });
    const outcome = resolveEra(message, headers({ "MCP-Protocol-Version": "2025-11-25", "Mcp-Method": "tools/list" }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.error.code).toBe(JSON_RPC_ERROR.UNSUPPORTED_PROTOCOL_VERSION);
  });

  it.each([[""], [42], [null]])("answers -32602 to protocol version metadata %j", (value) => {
    const message = parsed({ jsonrpc: "2.0", id: 3, method: "tools/list", params: { _meta: { [PROTOCOL_VERSION_META]: value } } });
    const outcome = resolveEra(message, headers({ "MCP-Protocol-Version": MODERN_PROTOCOL_VERSION, "Mcp-Method": "tools/list" }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.error.code).toBe(JSON_RPC_ERROR.INVALID_PARAMS);
  });

  it("refuses initialize that carries modern metadata (5.3 item 4)", () => {
    const message = parsed({ jsonrpc: "2.0", id: 1, method: "initialize", params: modernMeta });
    const outcome = resolveEra(message, headers({ "MCP-Protocol-Version": MODERN_PROTOCOL_VERSION, "Mcp-Method": "initialize" }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.error.code).toBe(JSON_RPC_ERROR.HEADER_MISMATCH);
  });
});

describe("resolveEra: clients that open with initialize (5.3 item 3)", () => {
  const legacyList = parsed({ jsonrpc: "2.0", id: 2, method: "tools/list" });

  it("takes the version of initialize from the body, ignoring the header", () => {
    const message = parsed({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    expect(resolveEra(message, headers({ "MCP-Protocol-Version": "garbage" }))).toEqual({
      ok: true,
      value: { kind: "legacy", version: "2025-06-18" },
    });
  });

  it("assumes 2025-03-26 when the version header is missing", () => {
    expect(resolveEra(legacyList, headers())).toEqual({ ok: true, value: { kind: "legacy", version: HEADERLESS_LEGACY_VERSION } });
  });

  it.each(LEGACY_PROTOCOL_VERSIONS.map((version) => [version]))("accepts the legacy version %s in the header", (version) => {
    expect(resolveEra(legacyList, headers({ "MCP-Protocol-Version": version }))).toEqual({ ok: true, value: { kind: "legacy", version } });
  });

  it("refuses the modern version in the header when the body has no metadata", () => {
    const outcome = resolveEra(legacyList, headers({ "MCP-Protocol-Version": MODERN_PROTOCOL_VERSION }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure).toMatchObject({ httpStatus: 400, error: { code: JSON_RPC_ERROR.HEADER_MISMATCH } });
  });

  it.each([["2024-11-05"], ["1900-01-01"], ["latest"]])("answers -32022 to the header version %s", (version) => {
    const outcome = resolveEra(legacyList, headers({ "MCP-Protocol-Version": version }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure).toMatchObject({
      httpStatus: 400,
      id: 2,
      error: { code: JSON_RPC_ERROR.UNSUPPORTED_PROTOCOL_VERSION, data: { requested: version } },
    });
  });

  it("checks the version header of notifications too", () => {
    const message = parsed({ jsonrpc: "2.0", method: "notifications/initialized" });
    const outcome = resolveEra(message, headers({ "MCP-Protocol-Version": "1999-01-01" }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.id).toBeNull();
  });
});

describe("negotiateLegacyVersion", () => {
  it.each(LEGACY_PROTOCOL_VERSIONS.map((version) => [version]))("keeps the supported version %s", (version) => {
    expect(negotiateLegacyVersion({ protocolVersion: version })).toBe(version);
  });

  it.each([[MODERN_PROTOCOL_VERSION], ["2024-11-05"], [undefined], [12]])("answers the newest legacy version to %j", (requested) => {
    expect(negotiateLegacyVersion({ protocolVersion: requested })).toBe("2025-11-25");
  });
});

describe("results and messages", () => {
  it("adds resultType only to modern results", () => {
    expect(completeResult({ kind: "modern", version: MODERN_PROTOCOL_VERSION }, { a: 1 })).toEqual({ resultType: "complete", a: 1 });
    expect(completeResult({ kind: "legacy", version: "2025-06-18" }, { a: 1 })).toEqual({ a: 1 });
  });

  it("describes the server in server/discover", () => {
    expect(discoverResult({ kind: "modern", version: MODERN_PROTOCOL_VERSION })).toMatchObject({
      resultType: "complete",
      supportedVersions: SUPPORTED_PROTOCOL_VERSIONS,
      capabilities: { tools: { listChanged: false } },
      _meta: { "io.modelcontextprotocol/serverInfo": SERVER_INFO },
    });
  });

  it("answers initialize with the negotiated version, tools capability and server info", () => {
    expect(initializeResult("2025-06-18")).toMatchObject({
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
    });
  });

  it("supports exactly the modern revision and three legacy ones", () => {
    expect(SUPPORTED_PROTOCOL_VERSIONS).toEqual(["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"]);
  });

  it("builds success and error messages, leaving out a missing id", () => {
    expect(successMessage(4, { ok: true })).toEqual({ jsonrpc: "2.0", id: 4, result: { ok: true } });
    expect(errorMessage({ id: null, error: { code: -1, message: "x" } })).toEqual({ jsonrpc: "2.0", error: { code: -1, message: "x" } });
    expect(errorMessage({ id: "a", error: { code: -1, message: "x" } })).toEqual({ jsonrpc: "2.0", id: "a", error: { code: -1, message: "x" } });
  });
});
