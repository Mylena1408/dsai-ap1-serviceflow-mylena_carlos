import { beforeEach, describe, expect, it, vi } from "vitest";

// SPEC 2026-11-05-mcp-documentos, 5.1 and 5.2 (SF-139): the HTTP transport with the token
// authentication and the module operations replaced by doubles.

const doubles = vi.hoisted(() => ({
  authenticateApiRequest: vi.fn(),
  createMcpToolOperations: vi.fn(),
  seenUsers: [] as unknown[],
}));

vi.mock("@/modules/api-tokens", () => ({ authenticateApiRequest: doubles.authenticateApiRequest }));
vi.mock("@/modules/mcp/infrastructure/operations", () => ({ createMcpToolOperations: doubles.createMcpToolOperations }));

import { currentApiUser } from "@/server/auth/api-context";
import { MAX_MCP_BODY_BYTES, handleMcpPost, methodNotAllowed } from "@/modules/mcp/infrastructure/http";
import { JSON_RPC_ERROR, MODERN_PROTOCOL_VERSION } from "@/modules/mcp/domain/protocol";

const user = { id: "u1", name: "Ana", email: "ana@example.com", role: "REQUESTER", sectorId: null, isActive: true };
const authenticated = { ok: true, user, tokenId: "t1", scope: "READ", expiresAt: new Date("2027-01-01T00:00:00Z"), sectorName: null };
const infrastructure = { database: {} as never, storage: {} as never };
const token = `sf_${"a".repeat(43)}`;

function post(body: unknown, headers: Record<string, string> = {}, url = "https://serviceflow.test/api/mcp"): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}`, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const modernMeta = { _meta: { "io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOL_VERSION } };
const modernHeaders = (method: string, name?: string) => ({
  "MCP-Protocol-Version": MODERN_PROTOCOL_VERSION,
  "Mcp-Method": method,
  ...(name ? { "Mcp-Name": name } : {}),
});

beforeEach(() => {
  doubles.authenticateApiRequest.mockReset().mockResolvedValue(authenticated);
  doubles.seenUsers.length = 0;
  doubles.createMcpToolOperations.mockReset().mockImplementation(() => ({
    findRequests: vi.fn(async () => {
      doubles.seenUsers.push(currentApiUser());
      return { items: [], page: 1, pageCount: 1, total: 0 };
    }),
    listRequestAttachments: vi.fn(async () => []),
    listComments: vi.fn(async () => []),
    readRequestDocument: vi.fn(),
    readCommentFile: vi.fn(),
  }));
});

describe("transport refusals before authentication (5.2)", () => {
  it("answers GET and DELETE with 405 and Allow: POST", async () => {
    const response = methodNotAllowed();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(await response.json()).toMatchObject({ jsonrpc: "2.0", error: { code: JSON_RPC_ERROR.INVALID_REQUEST } });
  });

  it("refuses an Origin from another site with 403", async () => {
    const response = await handleMcpPost(post({ jsonrpc: "2.0", id: 1, method: "ping" }, { origin: "https://evil.example" }), infrastructure);
    expect(response.status).toBe(403);
    expect(doubles.authenticateApiRequest).not.toHaveBeenCalled();
  });

  it("refuses an Origin that is not a URL", async () => {
    const response = await handleMcpPost(post({ jsonrpc: "2.0", id: 1, method: "ping" }, { origin: "null" }), infrastructure);
    expect(response.status).toBe(403);
  });

  it("accepts the server's own Origin", async () => {
    const response = await handleMcpPost(post({ jsonrpc: "2.0", id: 1, method: "ping" }, { origin: "https://serviceflow.test" }), infrastructure);
    expect(response.status).toBe(200);
  });

  it.each([["text/plain"], ["application/x-www-form-urlencoded"], ["application/jsonx"]])("refuses Content-Type %s with 415", async (type) => {
    const response = await handleMcpPost(post({ jsonrpc: "2.0", id: 1, method: "ping" }, { "content-type": type }), infrastructure);
    expect(response.status).toBe(415);
    expect(doubles.authenticateApiRequest).not.toHaveBeenCalled();
  });

  it("accepts application/json with a charset", async () => {
    const response = await handleMcpPost(post({ jsonrpc: "2.0", id: 1, method: "ping" }, { "content-type": "application/json; charset=utf-8" }), infrastructure);
    expect(response.status).toBe(200);
  });

  it.each([["text/event-stream"], ["text/html"]])("refuses Accept %s with 406", async (accept) => {
    const response = await handleMcpPost(post({ jsonrpc: "2.0", id: 1, method: "ping" }, { accept }), infrastructure);
    expect(response.status).toBe(406);
  });

  it.each([["*/*"], ["application/*"], ["application/json;q=0.9"], [""]])("accepts Accept %j", async (accept) => {
    const response = await handleMcpPost(post({ jsonrpc: "2.0", id: 1, method: "ping" }, { accept }), infrastructure);
    expect(response.status).toBe(200);
  });
});

describe("authentication (5.1)", () => {
  it("checks the token as a read (GET), with the request headers", async () => {
    await handleMcpPost(post({ jsonrpc: "2.0", id: 1, method: "ping" }), infrastructure);
    const [checked] = doubles.authenticateApiRequest.mock.calls[0];
    expect(checked.method).toBe("GET");
    expect(checked.headers.get("authorization")).toBe(`Bearer ${token}`);
  });

  it("answers an invalid token with 401, WWW-Authenticate and a JSON-RPC error without id", async () => {
    doubles.authenticateApiRequest.mockResolvedValue({ ok: false, error: "invalid_token" });
    const response = await handleMcpPost(post({ jsonrpc: "2.0", id: 1, method: "tools/list" }), infrastructure);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(await response.json()).toEqual({ jsonrpc: "2.0", error: { code: JSON_RPC_ERROR.UNAUTHORIZED, message: "Invalid or missing token." } });
    expect(doubles.createMcpToolOperations).not.toHaveBeenCalled();
  });

  it("answers the rate limit with 429 and Retry-After", async () => {
    doubles.authenticateApiRequest.mockResolvedValue({ ok: false, error: "rate_limited", retryAfterSeconds: 17 });
    const response = await handleMcpPost(post({ jsonrpc: "2.0", id: 1, method: "tools/list" }), infrastructure);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect((await response.json()).error.code).toBe(JSON_RPC_ERROR.RATE_LIMITED);
  });

  it("answers an insufficient scope with 403", async () => {
    doubles.authenticateApiRequest.mockResolvedValue({ ok: false, error: "insufficient_scope" });
    const response = await handleMcpPost(post({ jsonrpc: "2.0", id: 1, method: "tools/list" }), infrastructure);
    expect(response.status).toBe(403);
  });

  it("authenticates before reading the body", async () => {
    doubles.authenticateApiRequest.mockResolvedValue({ ok: false, error: "invalid_token" });
    const response = await handleMcpPost(post("{not json"), infrastructure);
    expect(response.status).toBe(401);
  });
});

describe("messages (5.2 and 5.3)", () => {
  it("answers 413 to a body larger than 64 KiB", async () => {
    const big = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { pad: "x".repeat(MAX_MCP_BODY_BYTES) } });
    const response = await handleMcpPost(post(big), infrastructure);
    expect(response.status).toBe(413);
  });

  it("answers 413 from the declared Content-Length", async () => {
    const request = post({ jsonrpc: "2.0", id: 1, method: "ping" }, { "content-length": String(MAX_MCP_BODY_BYTES + 1) });
    expect((await handleMcpPost(request, infrastructure)).status).toBe(413);
  });

  it("answers a parse error with 400 and -32700", async () => {
    const response = await handleMcpPost(post("{oops"), infrastructure);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(JSON_RPC_ERROR.PARSE_ERROR);
  });

  it("answers a batch with 400 and -32600", async () => {
    const response = await handleMcpPost(post([{ jsonrpc: "2.0", id: 1, method: "ping" }]), infrastructure);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(JSON_RPC_ERROR.INVALID_REQUEST);
  });

  it("answers a header mismatch with 400 and -32020", async () => {
    const response = await handleMcpPost(post({ jsonrpc: "2.0", id: 1, method: "tools/list", params: modernMeta }, { "MCP-Protocol-Version": MODERN_PROTOCOL_VERSION }), infrastructure);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ id: 1, error: { code: JSON_RPC_ERROR.HEADER_MISMATCH } });
  });

  it("answers a notification with 202 and no body", async () => {
    const response = await handleMcpPost(post({ jsonrpc: "2.0", method: "notifications/initialized" }), infrastructure);
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });

  it("runs a modern tool call as the token owner, answering JSON without a session", async () => {
    const response = await handleMcpPost(
      post(
        { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "find_requests", arguments: {}, ...modernMeta } },
        { ...modernHeaders("tools/call", "find_requests"), "mcp-session-id": "client-made-up" },
      ),
      infrastructure,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("mcp-session-id")).toBeNull();
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(await response.json()).toMatchObject({ jsonrpc: "2.0", id: 9, result: { resultType: "complete", isError: false } });
    expect(doubles.seenUsers).toEqual([user]);
    expect(currentApiUser()).toBeUndefined();
    const [caller] = doubles.createMcpToolOperations.mock.calls[0];
    expect(caller).toEqual({ user, scope: "READ", expiresAt: authenticated.expiresAt, sectorName: null });
  });

  it("serves a legacy session: initialize, initialized notification and tools/list", async () => {
    const init = await handleMcpPost(
      post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "c", version: "1" } } }),
      infrastructure,
    );
    expect(init.status).toBe(200);
    expect(init.headers.get("mcp-session-id")).toBeNull();
    expect((await init.json()).result.protocolVersion).toBe("2025-11-25");

    const initialized = await handleMcpPost(post({ jsonrpc: "2.0", method: "notifications/initialized" }, { "MCP-Protocol-Version": "2025-11-25" }), infrastructure);
    expect(initialized.status).toBe(202);

    const list = await handleMcpPost(post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { "MCP-Protocol-Version": "2025-11-25" }), infrastructure);
    const body = await list.json();
    expect(body.result.tools).toHaveLength(4);
    expect(body.result).not.toHaveProperty("resultType");
  });

  it("answers an unknown method with 404 and -32601", async () => {
    const response = await handleMcpPost(post({ jsonrpc: "2.0", id: 3, method: "resources/list" }), infrastructure);
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe(JSON_RPC_ERROR.METHOD_NOT_FOUND);
  });
});
