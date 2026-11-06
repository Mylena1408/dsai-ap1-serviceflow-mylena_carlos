import { createHash } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "../../scripts/demo-data";
import { minimalPdf } from "../unit/modules/attachments/synthetic-files";
import { ENTRANCE } from "./entrance";

// SPEC 2026-11-05-mcp-documentos, section 8 (SF-141): the requester sends a document on the screen,
// creates a read-only token on "Acesso à API", where the MCP instructions are shown, and an MCP
// client without the browser's cookies finds the request and reads the same bytes, in both eras of
// the protocol. After the revocation, the endpoint answers 401.

const unique = `e2e-mcp-${Date.now()}`;
const description = `${unique} férias de janeiro`;
const pdf = Buffer.from(minimalPdf());
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const MODERN = "2026-07-28";

async function enterAs(page: Page, profile: "Solicitante") {
  await page.goto("/");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration
  await page.getByRole("button", { name: `Entrar como ${profile}` }).click();
  await expect(page).not.toHaveURL(ENTRANCE);
}

type Rpc = { status: number; headers: Record<string, string>; body: Record<string, unknown> | null };

function client(api: APIRequestContext, token: string) {
  let id = 0;
  return async function rpc(method: string, params: Record<string, unknown> = {}, extraHeaders: Record<string, string> = {}, notification = false): Promise<Rpc> {
    const message = notification ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: ++id, method, params };
    const response = await api.post("/api/mcp", {
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...extraHeaders,
      },
      data: message,
    });
    const text = await response.text();
    return { status: response.status(), headers: response.headers(), body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
  };
}

type ToolResult = { content: Array<Record<string, unknown>>; structuredContent?: Record<string, unknown>; isError: boolean };

test("an MCP client reads with a read-only token the document sent on the screen", async ({ page, playwright }) => {
  test.setTimeout(180_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  try {
    await seedDemoData(database);
  } finally {
    await database.$disconnect();
  }

  // The requester opens a vacation request with its PDF.
  await enterAs(page, "Solicitante");
  await page.goto("/catalog");
  await page.getByRole("link", { name: "Solicitação de férias" }).click();
  await page.getByLabel("Descreva o que você precisa").fill(description);
  await page.getByLabel("Formulário de férias (obrigatório)").setInputFiles({ name: "ferias.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.getByRole("button", { name: "Enviar solicitação" }).click();
  await expect(page.getByRole("status")).toHaveText("Sua solicitação foi aberta.");
  const requestId = new URL(page.url()).pathname.split("/").at(-1)!;

  // "Acesso à API" shows how to connect an assistant, then a read-only token is created (5.5).
  await page.goto("/account/api-tokens");
  await page.waitForLoadState("networkidle");
  const instructions = page.getByRole("region", { name: "Assistentes de IA (MCP)" });
  await expect(instructions).toContainText("http://127.0.0.1:3100/api/mcp");
  await expect(instructions).toContainText("claude mcp add --transport http serviceflow");
  await expect(instructions).toContainText("O assistente lê tudo o que você lê");
  await page.getByLabel("Nome").fill(`${unique} assistente`);
  await page.getByLabel("Escopo").selectOption("READ");
  await page.getByRole("button", { name: "Criar token" }).click();
  const token = await page.locator("input.api-token-value").inputValue();
  expect(token).toMatch(/^sf_/);

  const api = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3100" });
  const rpc = client(api, token);

  // A client that opens with initialize (CA-MCP-09).
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
  expect(init.status).toBe(200);
  expect(init.headers["mcp-session-id"]).toBeUndefined();
  expect(init.headers["cache-control"]).toBe("no-store");
  expect(init.body).toMatchObject({ result: { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } } } });
  expect((await rpc("notifications/initialized", {}, { "MCP-Protocol-Version": "2025-06-18" }, true)).status).toBe(202);

  const legacy = { "MCP-Protocol-Version": "2025-06-18" };
  const tools = await rpc("tools/list", {}, legacy);
  expect(((tools.body!.result as { tools: Array<{ name: string }> }).tools).map(({ name }) => name)).toEqual([
    "find_requests",
    "list_request_documents",
    "read_request_document",
    "read_comment_file",
  ]);

  const found = (await rpc("tools/call", { name: "find_requests", arguments: { q: unique } }, legacy)).body!.result as ToolResult;
  expect((found.structuredContent as { items: Array<{ id: string }> }).items.map(({ id }) => id)).toEqual([requestId]);

  const listed = (await rpc("tools/call", { name: "list_request_documents", arguments: { requestId } }, legacy)).body!.result as ToolResult;
  const documents = (listed.structuredContent as { documents: Array<{ id: string; fileName: string; requirement: string }> }).documents;
  expect(documents).toEqual([expect.objectContaining({ fileName: "ferias.pdf", requirement: "Formulário de férias" })]);

  const read = (await rpc("tools/call", { name: "read_request_document", arguments: { requestId, attachmentId: documents[0]!.id } }, legacy)).body!
    .result as ToolResult;
  const resource = read.content[1] as { resource: { mimeType: string; blob: string } };
  expect(resource.resource.mimeType).toBe("application/pdf");
  expect(sha256(Buffer.from(resource.resource.blob, "base64"))).toBe(sha256(pdf));

  // A modern client, without initialize (CA-MCP-08).
  const meta = { _meta: { "io.modelcontextprotocol/protocolVersion": MODERN } };
  const modern = await rpc(
    "tools/call",
    { name: "list_request_documents", arguments: { requestId }, ...meta },
    { "MCP-Protocol-Version": MODERN, "Mcp-Method": "tools/call", "Mcp-Name": "list_request_documents" },
  );
  expect(modern.body).toMatchObject({ result: { resultType: "complete", isError: false } });
  const refused = await rpc("tools/list", meta, { "MCP-Protocol-Version": MODERN });
  expect(refused.status).toBe(400);
  expect(refused.body).toMatchObject({ error: { code: -32020 } });

  // GET belongs to the old session transport (CA-MCP-10).
  expect((await api.get("/api/mcp", { headers: { authorization: `Bearer ${token}` } })).status()).toBe(405);

  // After the revocation the endpoint refuses the token (CA-MCP-01).
  await page.goto("/account/api-tokens");
  await page.getByRole("button", { name: "Revogar" }).click();
  await expect(page.getByText("Token revogado. Ele deixa de funcionar na próxima chamada.")).toBeVisible();
  const afterRevocation = await rpc("tools/list", {}, legacy);
  expect(afterRevocation.status).toBe(401);
  expect(afterRevocation.headers["www-authenticate"]).toBe("Bearer");
  await api.dispose();
});
