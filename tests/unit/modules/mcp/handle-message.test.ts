import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommentRecord } from "@/modules/comments";
import type { RequestAttachmentSummary } from "@/modules/requests";
import { handleMessage } from "@/modules/mcp/application/handle-message";
import type { McpCaller, McpToolOperations } from "@/modules/mcp/application/ports";
import { MANAGER_COMMENT_FILES_NOTE } from "@/modules/mcp/application/run-tool";
import { JSON_RPC_ERROR, MODERN_PROTOCOL_VERSION, type Era, type McpMessage } from "@/modules/mcp/domain/protocol";
import { TOOL_DEFINITIONS } from "@/modules/mcp/domain/tools";
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  InternalServerError,
  NotFoundError,
  ValidationError,
} from "@/server/errors";

// SPEC 2026-11-05-mcp-documentos, 5.3 item 5 and 5.4 (SF-139).

const modern: Era = { kind: "modern", version: MODERN_PROTOCOL_VERSION };
const legacy: Era = { kind: "legacy", version: "2025-06-18" };
const requester: McpCaller = { role: "REQUESTER" };
const manager: McpCaller = { role: "MANAGER" };

const requestId = "11111111-1111-4111-8111-111111111111";
const attachmentId = "22222222-2222-4222-8222-222222222222";
const commentId = "33333333-3333-4333-8333-333333333333";
const fileId = "44444444-4444-4444-8444-444444444444";

const attachment: RequestAttachmentSummary = {
  id: attachmentId,
  requirementNameSnapshot: "Formulário de férias",
  requirementRequiredSnapshot: true,
  originalFilename: "ferias.pdf",
  detectedFormat: "PDF",
  sizeBytes: 1234,
  createdAt: new Date("2026-11-05T10:00:00Z"),
};

const comment: CommentRecord = {
  id: commentId,
  requestId,
  body: "Segue o arquivo",
  isInternal: false,
  createdAt: new Date("2026-11-05T11:00:00Z"),
  author: { id: "a", name: "Ana", role: "REQUESTER" },
  files: [{ id: fileId, originalFilename: "nota.txt", detectedFormat: "TXT", sizeBytes: 5, removed: false }],
};

function operations(overrides: Partial<McpToolOperations> = {}): McpToolOperations {
  return {
    findRequests: vi.fn(async () => ({ items: [], page: 1, pageCount: 1, total: 0 })),
    listRequestAttachments: vi.fn(async () => [attachment]),
    listComments: vi.fn(async () => [comment]),
    readRequestDocument: vi.fn(async () => ({ filename: "ferias.pdf", contentType: "application/pdf", bytes: new Uint8Array([37, 80, 68, 70]) })),
    readCommentFile: vi.fn(async () => ({ filename: "nota.txt", contentType: "text/plain; charset=utf-8", bytes: new TextEncoder().encode("hello") })),
    ...overrides,
  };
}

function request(method: string, params: Record<string, unknown> = {}, id: string | number = 1): McpMessage {
  return { kind: "request", id, method, params };
}

function call(name: string, args?: unknown): McpMessage {
  return request("tools/call", args === undefined ? { name } : { name, arguments: args });
}

async function result(message: McpMessage, era: Era = modern, caller: McpCaller = requester, ops = operations()) {
  const answer = await handleMessage(message, era, caller, ops);
  if (!("body" in answer)) throw new Error("expected a body");
  return { status: answer.status, body: answer.body as { id?: unknown; result?: Record<string, unknown>; error?: { code: number; message: string } } };
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("handleMessage: methods", () => {
  it("accepts any notification with 202 and no body", async () => {
    expect(await handleMessage({ kind: "notification", method: "notifications/initialized", params: {} }, legacy, requester, operations())).toEqual({ status: 202 });
    expect(await handleMessage({ kind: "notification", method: "notifications/cancelled", params: {} }, modern, requester, operations())).toEqual({ status: 202 });
  });

  it("answers initialize in the legacy era with the negotiated version", async () => {
    const { status, body } = await result(request("initialize", { protocolVersion: "2025-06-18" }), legacy);
    expect(status).toBe(200);
    expect(body).toMatchObject({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } } } });
    expect(body.result).not.toHaveProperty("resultType");
  });

  it("does not answer initialize in the modern era", async () => {
    const { status, body } = await result(request("initialize"), modern);
    expect(status).toBe(404);
    expect(body.error?.code).toBe(JSON_RPC_ERROR.METHOD_NOT_FOUND);
  });

  it("answers server/discover in both eras", async () => {
    expect((await result(request("server/discover"), modern)).body.result).toMatchObject({ resultType: "complete", supportedVersions: expect.any(Array) });
    expect((await result(request("server/discover"), legacy)).body.result).toMatchObject({ supportedVersions: expect.any(Array) });
  });

  it("answers ping with an empty result", async () => {
    expect((await result(request("ping", {}, "p"), legacy)).body).toEqual({ jsonrpc: "2.0", id: "p", result: {} });
    expect((await result(request("ping"), modern)).body.result).toEqual({ resultType: "complete" });
  });

  it("lists the four tools", async () => {
    const { body } = await result(request("tools/list"));
    expect(body.result).toEqual({ resultType: "complete", tools: TOOL_DEFINITIONS });
  });

  it.each([["resources/list"], ["prompts/list"], ["subscriptions/listen"], ["logging/setLevel"], ["tools/delete"]])(
    "answers 404 with -32601 to %s",
    async (method) => {
      const { status, body } = await result(request(method, {}, 5));
      expect(status).toBe(404);
      expect(body).toEqual({ jsonrpc: "2.0", id: 5, error: { code: JSON_RPC_ERROR.METHOD_NOT_FOUND, message: "Method not found" } });
    },
  );

  it.each([["delete_request"], [undefined], [42]])("answers -32602 to the unknown tool %j", async (name) => {
    const ops = operations();
    const { status, body } = await result(request("tools/call", { name }), modern, requester, ops);
    expect(status).toBe(200);
    expect(body.error).toEqual({ code: JSON_RPC_ERROR.INVALID_PARAMS, message: "Unknown tool" });
    expect(ops.findRequests).not.toHaveBeenCalled();
  });
});

describe("handleMessage: tools", () => {
  it("passes find_requests filters as the API query", async () => {
    const ops = operations();
    const { body } = await result(call("find_requests", { q: "férias", status: ["OPEN"], page: 2, filter: "all" }), modern, requester, ops);
    expect(ops.findRequests).toHaveBeenCalledWith({ q: "férias", status: ["OPEN"], page: "2", filter: "all" });
    expect(body.result).toMatchObject({ resultType: "complete", isError: false, structuredContent: { items: [], total: 0 } });
  });

  it("runs find_requests without arguments", async () => {
    const ops = operations();
    await result(call("find_requests"), legacy, requester, ops);
    expect(ops.findRequests).toHaveBeenCalledWith({ q: undefined, status: undefined, page: undefined, filter: undefined });
  });

  it("lists documents and visible comment files", async () => {
    const { body } = await result(call("list_request_documents", { requestId }));
    expect(body.result?.structuredContent).toEqual({
      requestId,
      documents: [
        {
          id: attachmentId,
          requirement: "Formulário de férias",
          required: true,
          fileName: "ferias.pdf",
          format: "PDF",
          sizeBytes: 1234,
          sentAt: "2026-11-05T10:00:00.000Z",
          removed: false,
        },
      ],
      commentFiles: [
        {
          commentId,
          fileId,
          internalNote: false,
          commentedAt: "2026-11-05T11:00:00.000Z",
          fileName: "nota.txt",
          format: "TXT",
          sizeBytes: 5,
          removed: false,
        },
      ],
    });
  });

  it("hides the names of removed files", async () => {
    const ops = operations({
      listRequestAttachments: vi.fn(async () => [{ ...attachment, removedAt: new Date() }]),
      listComments: vi.fn(async () => [{ ...comment, files: [{ ...comment.files![0], removed: true }] }]),
    });
    const { body } = await result(call("list_request_documents", { requestId }), modern, requester, ops);
    const content = body.result?.structuredContent as { documents: Array<Record<string, unknown>>; commentFiles: Array<Record<string, unknown>> };
    expect(content.documents[0]).toMatchObject({ fileName: null, removed: true });
    expect(content.commentFiles[0]).toMatchObject({ fileName: null, removed: true });
  });

  it("does not read comments for a manager and says why", async () => {
    const ops = operations();
    const { body } = await result(call("list_request_documents", { requestId }), modern, manager, ops);
    expect(ops.listComments).not.toHaveBeenCalled();
    expect(body.result?.structuredContent).toMatchObject({ commentFiles: [], commentFilesNote: MANAGER_COMMENT_FILES_NOTE });
  });

  it("does not read comments when the attachments are refused", async () => {
    const ops = operations({ listRequestAttachments: vi.fn(async () => Promise.reject(new NotFoundError())) });
    const { body } = await result(call("list_request_documents", { requestId }), modern, requester, ops);
    expect(ops.listComments).not.toHaveBeenCalled();
    expect(body.result).toEqual({ resultType: "complete", content: [{ type: "text", text: "Not found." }], isError: true });
  });

  it("reads a request document as an embedded resource", async () => {
    const ops = operations();
    const { body } = await result(call("read_request_document", { requestId, attachmentId }), modern, requester, ops);
    expect(ops.readRequestDocument).toHaveBeenCalledWith(requestId, attachmentId);
    expect(body.result?.content).toEqual([
      { type: "text", text: 'File "ferias.pdf" (application/pdf, 4 B).' },
      { type: "resource", resource: { uri: `serviceflow://requests/${requestId}/documents/${attachmentId}`, mimeType: "application/pdf", blob: "JVBERg==" } },
    ]);
  });

  it("reads a comment file as text", async () => {
    const ops = operations();
    const { body } = await result(call("read_comment_file", { requestId, commentId, fileId }), legacy, requester, ops);
    expect(ops.readCommentFile).toHaveBeenCalledWith(requestId, commentId, fileId);
    expect(body.result).toEqual({
      content: [
        { type: "text", text: 'File "nota.txt" (text/plain; charset=utf-8, 5 B).' },
        { type: "text", text: "hello" },
      ],
      isError: false,
    });
  });

  it("answers invalid arguments as a tool error without running the operation", async () => {
    const ops = operations();
    const { status, body } = await result(call("read_request_document", { requestId }), modern, requester, ops);
    expect(status).toBe(200);
    expect(body.result).toMatchObject({ isError: true });
    expect(JSON.stringify(body.result)).toContain("attachmentId: required");
    expect(ops.readRequestDocument).not.toHaveBeenCalled();
  });

  it.each([
    ["not found", new NotFoundError()],
    ["validation", new ValidationError([{ path: ["requestId"], code: "invalid_format" }])],
    ["authentication", new AuthenticationError()],
    ["authorization", new AuthorizationError()],
    ["conflict", new ConflictError()],
  ])("answers a %s refusal of a reading tool with the same Not found.", async (_case, error) => {
    const ops = operations({ readRequestDocument: vi.fn(async () => Promise.reject(error)) });
    const { body } = await result(call("read_request_document", { requestId, attachmentId }), modern, requester, ops);
    expect(body.result).toEqual({ resultType: "complete", content: [{ type: "text", text: "Not found." }], isError: true });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("names the refused filters of find_requests", async () => {
    const ops = operations({ findRequests: vi.fn(async () => Promise.reject(new ValidationError([{ path: ["search"], code: "invalid_value" }]))) });
    const { body } = await result(call("find_requests", { filter: "all" }), modern, requester, ops);
    expect(body.result).toMatchObject({ isError: true, content: [{ type: "text", text: "Invalid arguments. search: not accepted." }] });
  });

  it("answers Internal error. to an integrity failure, logging only the error name", async () => {
    const ops = operations({ readRequestDocument: vi.fn(async () => Promise.reject(new InternalServerError())) });
    const { body } = await result(call("read_request_document", { requestId, attachmentId }), modern, requester, ops);
    expect(body.result).toMatchObject({ isError: true, content: [{ type: "text", text: "Internal error." }] });
    expect(consoleError).toHaveBeenCalledWith("Unexpected error in an MCP tool.", "InternalServerError");
  });

  it("does not log arguments or messages of unexpected errors", async () => {
    const ops = operations({ readCommentFile: vi.fn(async () => Promise.reject(new TypeError(`broken ${requestId}`))) });
    const { body } = await result(call("read_comment_file", { requestId, commentId, fileId }), modern, requester, ops);
    expect(body.result).toMatchObject({ isError: true, content: [{ type: "text", text: "Internal error." }] });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(requestId);
    expect(consoleError).toHaveBeenCalledWith("Unexpected error in an MCP tool.", "TypeError");
  });
});
