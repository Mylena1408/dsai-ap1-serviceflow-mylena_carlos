import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";
import { minimalPdf, syntheticText } from "../unit/modules/attachments/synthetic-files";

vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});
const schedule = vi.hoisted(() => ({ scheduleEventProcessing: vi.fn() }));
vi.mock("@/server/jobs/schedule", () => schedule);

import { API_CALLS_PER_MINUTE, generateApiToken, rateWindowStart } from "@/modules/api-tokens";
import { addComment } from "@/modules/comments";
import { MODERN_PROTOCOL_VERSION, postMcp } from "@/modules/mcp";
import { getMe } from "@/modules/public-api";
import { createRequest } from "@/modules/requests";
import { runAsApiUser } from "@/server/auth";
import { createMemoryDocumentStorage, type DocumentStorage } from "@/server/storage";

// SPEC 2026-11-05-mcp-documentos over the database (SF-140; CA-MCP-01 to 07 and 11). The endpoint
// runs with the real token check, the real authorization of every operation and storage in memory.

const BASE = "https://serviceflow.test";

type Person = { id: string; name: string; email: string; role: Role; sectorId: string | null };

function asUser(person: Person) {
  return { id: person.id, name: person.name, email: person.email, role: person.role, sectorId: person.sectorId, isActive: true as const };
}

async function tokenFor(person: Person, scope: "READ" | "WRITE" = "READ", expiresInMs = 86_400_000) {
  const token = generateApiToken();
  const now = new Date();
  const record = await prisma.apiToken.create({
    data: {
      userId: person.id,
      name: `MCP ${scope}`,
      scope,
      tokenHash: token.hash,
      lastFour: token.lastFour,
      createdAt: now,
      expiresAt: new Date(now.getTime() + expiresInMs),
    },
  });
  return { value: token.value, id: record.id };
}

let storage: DocumentStorage & { readonly size: number };
let nextId = 1;

type RpcBody = { jsonrpc: string; id?: unknown; result?: Record<string, unknown>; error?: { code: number; message: string; data?: unknown } };

async function rpc(token: string | null, method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const id = nextId++;
  const response = await postMcp(
    new Request(`${BASE}/api/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    }),
    prisma,
    storage,
  );
  expect(response.headers.get("mcp-session-id")).toBeNull();
  return { status: response.status, headers: response.headers, body: (await response.json()) as RpcBody };
}

type ToolAnswer = { content: Array<Record<string, unknown>>; structuredContent?: Record<string, unknown>; isError: boolean };

async function tool(token: string, name: string, args: Record<string, unknown>) {
  const { status, body } = await rpc(token, "tools/call", { name, arguments: args });
  expect(status).toBe(200);
  return body.result as unknown as ToolAnswer;
}

const NOT_FOUND = { content: [{ type: "text", text: "Not found." }], isError: true };

async function scenario() {
  const category = await createDomainCategory();
  const sector = await createDomainSector();
  const otherSector = await createDomainSector();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const form = await prisma.serviceDocumentRequirement.create({
    data: { serviceId: service.id, name: "Requerimento", isRequired: true, acceptedFormats: ["PDF"], position: 0 },
  });
  const note = await prisma.serviceDocumentRequirement.create({
    data: { serviceId: service.id, name: "Observação", isRequired: false, acceptedFormats: ["TXT"], position: 1 },
  });
  const owner = await createDomainUser({ role: "REQUESTER" });
  const otherRequester = await createDomainUser({ role: "REQUESTER" });
  const attendant = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const otherAttendant = await createDomainUser({ role: "ATTENDANT", sectorId: otherSector.id });
  const manager = await createDomainUser({ role: "MANAGER", sectorId: sector.id });
  const admin = await createDomainUser({ role: "ADMIN" });

  const pdf = minimalPdf();
  const text = syntheticText();
  const request = await runAsApiUser(asUser(owner), () =>
    createRequest(
      {
        serviceId: service.id,
        description: "Pedido com documentos para o MCP",
        attachments: [
          { requirementId: form.id, name: "requerimento.pdf", bytes: pdf },
          { requirementId: note.id, name: "observacao.txt", bytes: text },
        ],
      },
      prisma,
      storage,
    ),
  );
  const attachments = await prisma.requestAttachment.findMany({ where: { requestId: request.id }, orderBy: { originalFilename: "asc" } });
  const [txtAttachment, pdfAttachment] = attachments;

  const shared = await runAsApiUser(asUser(owner), () =>
    addComment({ requestId: request.id, body: "Segue o laudo", files: [{ name: "laudo.pdf", bytes: pdf }] }, prisma, storage),
  );
  const internal = await runAsApiUser(asUser(attendant), () =>
    addComment(
      { requestId: request.id, body: "Orçamento interno", isInternal: true, files: [{ name: "orcamento.txt", bytes: text }] },
      prisma,
      storage,
    ),
  );

  return {
    sector,
    otherSector,
    service,
    owner,
    otherRequester,
    attendant,
    otherAttendant,
    manager,
    admin,
    request,
    pdf,
    text,
    pdfAttachment: pdfAttachment!,
    txtAttachment: txtAttachment!,
    shared: { commentId: shared.id, fileId: shared.files![0]!.id },
    internal: { commentId: internal.id, fileId: internal.files![0]!.id },
  };
}

beforeEach(() => {
  storage = createMemoryDocumentStorage();
  vi.clearAllMocks();
});

describe("MCP tokens and limits (CA-MCP-01 and 02)", () => {
  it("refuses a missing, unknown, revoked, expired or inactive owner's token before running anything", async () => {
    const { owner, otherRequester } = await scenario();
    const revoked = await tokenFor(owner);
    await prisma.apiToken.update({ where: { id: revoked.id }, data: { revokedAt: new Date(), revokedById: owner.id } });
    const expired = await tokenFor(owner, "READ", 1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const inactive = await tokenFor(otherRequester);
    await prisma.user.update({ where: { id: otherRequester.id }, data: { isActive: false } });

    for (const token of [null, `sf_${"x".repeat(43)}`, "not-a-token", revoked.value, expired.value, inactive.value]) {
      const { status, headers, body } = await rpc(token, "tools/list");
      expect(status).toBe(401);
      expect(headers.get("www-authenticate")).toBe("Bearer");
      expect(body).toEqual({ jsonrpc: "2.0", error: { code: -32001, message: "Invalid or missing token." } });
    }
  });

  it("accepts READ and WRITE tokens for every tool", async () => {
    const { owner, request, pdfAttachment, shared } = await scenario();
    for (const scope of ["READ", "WRITE"] as const) {
      const { value } = await tokenFor(owner, scope);
      expect((await tool(value, "find_requests", {})).isError).toBe(false);
      expect((await tool(value, "list_request_documents", { requestId: request.id })).isError).toBe(false);
      expect((await tool(value, "read_request_document", { requestId: request.id, attachmentId: pdfAttachment.id })).isError).toBe(false);
      expect((await tool(value, "read_comment_file", { requestId: request.id, ...shared })).isError).toBe(false);
    }
  });

  it("counts MCP calls in the same per-minute window as /api/v1 and answers 429 with Retry-After", async () => {
    const { owner } = await scenario();
    const token = await tokenFor(owner);

    // One call through /api/v1 and one through MCP land in the same window.
    expect((await getMe(new Request(`${BASE}/api/v1/me`, { headers: { authorization: `Bearer ${token.value}` } }))).status).toBe(200);
    expect((await rpc(token.value, "ping")).status).toBe(200);
    const window = await prisma.apiRateWindow.findFirstOrThrow({ where: { tokenId: token.id } });
    expect(window.count).toBe(2);

    await prisma.apiRateWindow.update({
      where: { tokenId_windowStart: { tokenId: token.id, windowStart: rateWindowStart(new Date()) } },
      data: { count: API_CALLS_PER_MINUTE },
    });
    const { status, headers, body } = await rpc(token.value, "tools/list");
    expect(status).toBe(429);
    expect(Number(headers.get("retry-after"))).toBeGreaterThan(0);
    expect(body.error?.code).toBe(-32003);
  });
});

describe("what each person reads (CA-MCP-03 to 06)", () => {
  it("lets the requester list and read their own documents and shared comment files (CA-MCP-03 and 07)", async () => {
    const { owner, request, pdf, text, pdfAttachment, txtAttachment, shared, internal } = await scenario();
    const { value } = await tokenFor(owner);

    const listed = await tool(value, "list_request_documents", { requestId: request.id });
    expect(listed.isError).toBe(false);
    const content = listed.structuredContent as { documents: Array<Record<string, unknown>>; commentFiles: Array<Record<string, unknown>> };
    expect(content.documents.map(({ fileName }) => fileName).sort()).toEqual(["observacao.txt", "requerimento.pdf"]);
    expect(content.documents.find(({ id }) => id === pdfAttachment.id)).toMatchObject({
      requirement: "Requerimento",
      required: true,
      format: "PDF",
      sizeBytes: pdf.length,
      removed: false,
    });
    // The internal note of the attendant never reaches the requester.
    expect(content.commentFiles).toEqual([expect.objectContaining({ ...shared, fileName: "laudo.pdf", internalNote: false })]);
    expect(JSON.stringify(content)).not.toContain(internal.fileId);

    const readPdf = await tool(value, "read_request_document", { requestId: request.id, attachmentId: pdfAttachment.id });
    const resource = readPdf.content[1] as { type: string; resource: { uri: string; mimeType: string; blob: string } };
    expect(resource.type).toBe("resource");
    expect(resource.resource.mimeType).toBe("application/pdf");
    expect(resource.resource.uri).toBe(`serviceflow://requests/${request.id}/documents/${pdfAttachment.id}`);
    expect(Buffer.from(resource.resource.blob, "base64").equals(Buffer.from(pdf))).toBe(true);

    const readTxt = await tool(value, "read_request_document", { requestId: request.id, attachmentId: txtAttachment.id });
    expect(readTxt.content[1]).toEqual({ type: "text", text: new TextDecoder().decode(text) });

    const readShared = await tool(value, "read_comment_file", { requestId: request.id, ...shared });
    expect(readShared.isError).toBe(false);
    expect((readShared.content[0] as { text: string }).text).toContain("laudo.pdf");

    // Direct reading of the internal note's file by its ids is refused like a missing file (CA-MCP-06).
    expect(await tool(value, "read_comment_file", { requestId: request.id, ...internal })).toEqual(NOT_FOUND);
  });

  it("answers another requester with the same Not found as a missing or malformed id", async () => {
    const { otherRequester, request, pdfAttachment, shared } = await scenario();
    const { value } = await tokenFor(otherRequester);
    const missing = "99999999-9999-4999-8999-999999999999";

    for (const args of [{ requestId: request.id }, { requestId: missing }, { requestId: "not-a-uuid" }]) {
      expect(await tool(value, "list_request_documents", args)).toEqual(NOT_FOUND);
    }
    for (const args of [
      { requestId: request.id, attachmentId: pdfAttachment.id },
      { requestId: missing, attachmentId: pdfAttachment.id },
      { requestId: request.id, attachmentId: missing },
      { requestId: request.id, attachmentId: "x" },
    ]) {
      expect(await tool(value, "read_request_document", args)).toEqual(NOT_FOUND);
    }
    expect(await tool(value, "read_comment_file", { requestId: request.id, ...shared })).toEqual(NOT_FOUND);

    const found = await tool(value, "find_requests", {});
    expect((found.structuredContent as { items: unknown[] }).items).toEqual([]);
  });

  it("lets the attendant of the current sector read everything, including internal notes, until a transfer (CA-MCP-04)", async () => {
    const { attendant, otherAttendant, request, otherSector, pdfAttachment, internal } = await scenario();
    const own = await tokenFor(attendant);
    const other = await tokenFor(otherAttendant);

    const listed = await tool(own.value, "list_request_documents", { requestId: request.id });
    expect((listed.structuredContent as { commentFiles: unknown[] }).commentFiles).toHaveLength(2);
    expect((await tool(own.value, "read_comment_file", { requestId: request.id, ...internal })).isError).toBe(false);
    expect((await tool(own.value, "read_request_document", { requestId: request.id, attachmentId: pdfAttachment.id })).isError).toBe(false);
    const queue = await tool(own.value, "find_requests", {});
    expect((queue.structuredContent as { items: Array<{ id: string }> }).items.map(({ id }) => id)).toContain(request.id);

    expect(await tool(other.value, "list_request_documents", { requestId: request.id })).toEqual(NOT_FOUND);

    // After the request moves to another sector, access follows the sector, as on the screens.
    await prisma.request.update({ where: { id: request.id }, data: { sectorId: otherSector.id } });
    expect(await tool(own.value, "read_request_document", { requestId: request.id, attachmentId: pdfAttachment.id })).toEqual(NOT_FOUND);
    expect((await tool(other.value, "read_request_document", { requestId: request.id, attachmentId: pdfAttachment.id })).isError).toBe(false);
  });

  it("follows the screen rule for managers and never lists comment files to them (CA-MCP-05)", async () => {
    const { manager, admin, request, pdfAttachment } = await scenario();
    const { value } = await tokenFor(manager);

    // A request without approval: only with "see every request of the sector".
    expect(await tool(value, "read_request_document", { requestId: request.id, attachmentId: pdfAttachment.id })).toEqual(NOT_FOUND);
    await prisma.userPermission.create({
      data: { userId: manager.id, permission: "SECTOR_REQUESTS_READ", grantedById: admin.id, grantedAt: new Date() },
    });
    expect((await tool(value, "read_request_document", { requestId: request.id, attachmentId: pdfAttachment.id })).isError).toBe(false);

    const listed = await tool(value, "list_request_documents", { requestId: request.id });
    expect(listed.structuredContent).toMatchObject({
      commentFiles: [],
      commentFilesNote: "Managers do not see comments, so comment files are not listed.",
    });
  });

  it("lets a manager read the documents of an approval of their sector without the permission", async () => {
    const { manager, owner, service } = await scenario();
    await prisma.service.update({ where: { id: service.id }, data: { requiresApproval: true } });
    const form = await prisma.serviceDocumentRequirement.findFirstOrThrow({ where: { serviceId: service.id, name: "Requerimento" } });
    const approval = await runAsApiUser(asUser(owner), () =>
      createRequest(
        { serviceId: service.id, description: "Pedido com aprovação", attachments: [{ requirementId: form.id, name: "pedido.pdf", bytes: minimalPdf() }] },
        prisma,
        storage,
      ),
    );
    const attachment = await prisma.requestAttachment.findFirstOrThrow({ where: { requestId: approval.id } });
    const { value } = await tokenFor(manager);

    expect((await tool(value, "read_request_document", { requestId: approval.id, attachmentId: attachment.id })).isError).toBe(false);
    const pending = await tool(value, "find_requests", {});
    expect((pending.structuredContent as { items: Array<{ id: string }> }).items.map(({ id }) => id)).toEqual([approval.id]);
  });
});

describe("integrity and no writes (CA-MCP-07 and 11)", () => {
  it("answers Internal error. when the stored bytes differ from the recorded hash", async () => {
    const { owner, request, pdfAttachment } = await scenario();
    const { value } = await tokenFor(owner);
    const tampered = minimalPdf();
    tampered[tampered.length - 1] ^= 0xff;
    await storage.remove(pdfAttachment.storageKey);
    await storage.put(pdfAttachment.storageKey, tampered, "application/pdf");

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await tool(value, "read_request_document", { requestId: request.id, attachmentId: pdfAttachment.id })).toEqual({
        content: [{ type: "text", text: "Internal error." }],
        isError: true,
      });
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(pdfAttachment.storageKey);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("changes nothing in the database or the storage when every tool runs", async () => {
    const { owner, attendant, request, pdfAttachment, shared } = await scenario();
    const counts = () =>
      Promise.all([
        prisma.request.count(),
        prisma.requestAttachment.count(),
        prisma.requestComment.count(),
        prisma.requestCommentFile.count(),
        prisma.requestStatusEvent.count(),
        prisma.outboxEvent.count(),
        prisma.auditEntry.count(),
      ]);
    const before = await counts();
    const objects = storage.size;
    const updatedAt = (await prisma.request.findUniqueOrThrow({ where: { id: request.id } })).updatedAt;

    for (const person of [owner, attendant]) {
      const { value } = await tokenFor(person);
      await tool(value, "find_requests", { status: ["OPEN"] });
      await tool(value, "list_request_documents", { requestId: request.id });
      await tool(value, "read_request_document", { requestId: request.id, attachmentId: pdfAttachment.id });
      await tool(value, "read_comment_file", { requestId: request.id, ...shared });
    }

    expect(await counts()).toEqual(before);
    expect(storage.size).toBe(objects);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: request.id } })).updatedAt).toEqual(updatedAt);
    expect(schedule.scheduleEventProcessing).not.toHaveBeenCalled();
  });

  it("answers argument errors as tool errors and unknown tools as protocol errors (CA-MCP-11)", async () => {
    const { owner, request } = await scenario();
    const { value } = await tokenFor(owner);

    const invalid = await tool(value, "read_request_document", { requestId: request.id, extra: true });
    expect(invalid.isError).toBe(true);
    expect((invalid.content[0] as { text: string }).text).toContain("unknown field(s): extra");

    const unknown = await rpc(value, "tools/call", { name: "delete_request", arguments: { requestId: request.id } });
    expect(unknown.body.error).toEqual({ code: -32602, message: "Unknown tool" });
  });
});

describe("protocol over the real endpoint (CA-MCP-08 and 09)", () => {
  it("serves a modern client without initialize", async () => {
    const { owner, request } = await scenario();
    const { value } = await tokenFor(owner);
    const meta = { _meta: { "io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOL_VERSION } };
    const headers = (method: string, name?: string) => ({
      "MCP-Protocol-Version": MODERN_PROTOCOL_VERSION,
      "Mcp-Method": method,
      ...(name ? { "Mcp-Name": name } : {}),
    });

    const discover = await rpc(value, "server/discover", meta, headers("server/discover"));
    expect(discover.body.result).toMatchObject({ resultType: "complete", supportedVersions: expect.arrayContaining([MODERN_PROTOCOL_VERSION]) });

    const called = await rpc(value, "tools/call", { name: "list_request_documents", arguments: { requestId: request.id }, ...meta }, headers("tools/call", "list_request_documents"));
    expect(called.body.result).toMatchObject({ resultType: "complete", isError: false });

    const mismatch = await rpc(value, "tools/call", { name: "list_request_documents", arguments: { requestId: request.id }, ...meta }, headers("tools/call", "find_requests"));
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error?.code).toBe(-32020);
  });

  it("serves a client that opens with initialize", async () => {
    const { owner } = await scenario();
    const { value } = await tokenFor(owner);

    const init = await rpc(value, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.body.result).toMatchObject({ protocolVersion: "2025-06-18", serverInfo: { name: "serviceflow" } });

    const list = await rpc(value, "tools/list", {}, { "MCP-Protocol-Version": "2025-06-18" });
    expect((list.body.result as { tools: Array<{ name: string }> }).tools.map(({ name }) => name)).toEqual([
      "find_requests",
      "list_request_documents",
      "read_request_document",
      "read_comment_file",
    ]);
  });
});
