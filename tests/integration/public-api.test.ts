import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./fixtures";

vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});
const schedule = vi.hoisted(() => ({ scheduleEventProcessing: vi.fn() }));
vi.mock("@/server/jobs/schedule", () => schedule);

import { generateApiToken, rateWindowStart } from "@/modules/api-tokens";
import { loadDemoData } from "@/modules/demo";
import { getMe, getOpenApiDocument, getRequest, getRequests, getServices, postComment, postRequest } from "@/modules/public-api";

// SPEC 2026-11-02-api-externa-webhooks, 5.3 and 5.4 (SF-113; CA-API-01, 03 to 09). The handlers run
// with real authorization: the token owner is the user of every use case.

const BASE = "https://serviceflow.test";
const emails = { ana: "ana.souza@exemplo.test", bruno: "bruno.lima@exemplo.test", diego: "diego.rocha@exemplo.test", paulo: "paulo.ribeiro@exemplo.test" };
type Person = keyof typeof emails;

async function tokenFor(person: Person, scope: "READ" | "WRITE" = "WRITE"): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: emails[person] } });
  const token = generateApiToken();
  const now = new Date();
  await prisma.apiToken.create({
    data: { userId: user.id, name: `${person} ${scope}`, scope, tokenHash: token.hash, lastFour: token.lastFour, createdAt: now, expiresAt: new Date(now.getTime() + 86_400_000) },
  });
  return token.value;
}

function call(path: string, token: string | null, init: { method?: string; body?: unknown; raw?: string; cookie?: string } = {}) {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (init.cookie) headers.cookie = init.cookie;
  if (init.body !== undefined || init.raw !== undefined) headers["content-type"] = "application/json";
  return new Request(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });
}

const params = (requestId: string) => ({ params: Promise.resolve({ requestId }) });

async function read(response: Response) {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
  // The JSON is checked by the assertions of each test.
  return { status: response.status, body: await response.json() };
}

async function requestOf(description: string) {
  return prisma.request.findFirstOrThrow({ where: { description } });
}

describe("/api/v1 (SF-113)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await loadDemoData(prisma);
  });

  it("serves the OpenAPI document without a token", async () => {
    const { status, body } = await read(getOpenApiDocument());
    expect(status).toBe(200);
    expect(body.openapi).toBe("3.1.0");
  });

  it("refuses calls without a valid token in the same format, ignoring browser cookies (CA-API-01, 03, 07)", async () => {
    for (const request of [call("/api/v1/me", null), call("/api/v1/me", null, { cookie: "authjs.session-token=qualquer" }), call("/api/v1/me", `sf_${"x".repeat(43)}`)]) {
      const response = await getMe(request);
      expect(response.headers.get("www-authenticate")).toBe("Bearer");
      expect(await read(response)).toEqual({
        status: 401,
        body: { error: { code: "invalid_token", message: "The token is missing, invalid, expired or revoked." } },
      });
    }
  });

  it("tells who the token owner is, with sector and token data", async () => {
    const { status, body } = await read(await getMe(call("/api/v1/me", await tokenFor("diego", "READ"))));

    expect(status).toBe(200);
    expect(body).toMatchObject({ name: "Diego Rocha", email: emails.diego, role: "ATTENDANT", sector: { name: "Central de Serviços" }, permissions: [], token: { scope: "READ" } });
  });

  it("lists the published catalog with documents and fields only for requesters (CA-API-05)", async () => {
    const { status, body } = await read(await getServices(call("/api/v1/services", await tokenFor("ana", "READ"))));
    expect(status).toBe(200);
    expect(body.items).toHaveLength(9);
    expect(body.items.find((service: { name: string }) => service.name === "Solicitação de férias").documents).toEqual([
      { name: "Formulário de férias", required: true, formats: ["PDF"] },
    ]);
    expect(body.items.find((service: { name: string }) => service.name === "Manutenção de ar-condicionado").fields).toHaveLength(5);

    expect(await read(await getServices(call("/api/v1/services", await tokenFor("diego"))))).toMatchObject({ status: 403, body: { error: { code: "forbidden" } } });
  });

  it("lists what each profile sees on its screen (CA-API-05)", async () => {
    const ana = await prisma.user.findUniqueOrThrow({ where: { email: emails.ana } });
    const own = await read(await getRequests(call("/api/v1/requests", await tokenFor("ana", "READ"))));
    expect(own.status).toBe(200);
    expect(own.body.total).toBe(await prisma.request.count({ where: { requesterId: ana.id } }));
    expect(own.body.items[0]).not.toHaveProperty("requesterId");

    const queue = await read(await getRequests(call("/api/v1/requests?status=OPEN&status=IN_PROGRESS&sla=overdue", await tokenFor("diego", "READ"))));
    expect(queue.body.items.map((item: { description: string }) => item.description)).toEqual(["Fui bloqueado no sistema de compras após três tentativas."]);
    expect(queue.body.items[0]).toMatchObject({ status: "OPEN", priority: "HIGH", slaSituation: "overdue" });

    const approvals = await read(await getRequests(call("/api/v1/requests", await tokenFor("paulo", "READ"))));
    expect(approvals.body).toMatchObject({ page: 1, pageCount: 1, total: 1 });
    expect(approvals.body.items[0]).toMatchObject({ approval: "PENDING", description: "Notebook para as reuniões fora do escritório." });

    const paulo = await tokenFor("paulo", "READ");
    expect(await read(await getRequests(call("/api/v1/requests?filter=sector", paulo)))).toMatchObject({ status: 403, body: { error: { code: "forbidden" } } });
    expect(await read(await getRequests(call("/api/v1/requests?filter=nada", paulo)))).toMatchObject({ status: 400, body: { error: { code: "invalid_request" } } });
    expect(await read(await getRequests(call("/api/v1/requests?status=PERDIDA", await tokenFor("ana", "READ"))))).toMatchObject({
      status: 400,
      body: { error: { code: "invalid_request", issues: [{ path: ["search"], code: "invalid_value" }] } },
    });
  });

  it("shows the detail with the rules of the screen, and 404 for what the person cannot read (CA-API-05)", async () => {
    const declaration = await requestOf("Declaração para apresentar no banco até sexta-feira.");
    const brunos = await requestOf("Fui bloqueado no sistema de compras após três tentativas.");
    const note = "Conferir a data de admissão no sistema de RH antes de emitir.";

    const ana = await read(await getRequest(call(`/api/v1/requests/${declaration.id}`, await tokenFor("ana", "READ")), params(declaration.id)));
    expect(ana.status).toBe(200);
    expect(ana.body).toMatchObject({ status: "IN_PROGRESS", assignee: { name: "Diego Rocha" }, history: { status: [{ to: "OPEN" }, { to: "IN_PROGRESS" }] } });
    expect(ana.body.comments.map((comment: { internal: boolean }) => comment.internal)).toEqual([false, false]);
    expect(JSON.stringify(ana.body)).not.toContain(note);

    const diego = await read(await getRequest(call(`/api/v1/requests/${declaration.id}`, await tokenFor("diego", "READ")), params(declaration.id)));
    expect(JSON.stringify(diego.body.comments)).toContain(note);

    const anaToken = await tokenFor("ana", "READ");
    for (const id of [brunos.id, "00000000-0000-4000-8000-000000000000"]) {
      expect(await read(await getRequest(call(`/api/v1/requests/${id}`, anaToken), params(id)))).toEqual({
        status: 404,
        body: { error: { code: "not_found", message: "The resource was not found." } },
      });
    }
    expect((await read(await getRequest(call("/api/v1/requests/nao-e-id", anaToken), params("nao-e-id")))).status).toBe(400);

    const pending = await requestOf("Notebook para as reuniões fora do escritório.");
    const paulo = await read(await getRequest(call(`/api/v1/requests/${pending.id}`, await tokenFor("paulo", "READ")), params(pending.id)));
    expect(paulo.body).toMatchObject({ approval: "PENDING", comments: [] });
  });

  it("opens requests with the rules of the screen (CA-API-04, 06)", async () => {
    const services = await prisma.service.findMany({ select: { id: true, name: true } });
    const serviceId = (name: string) => services.find((service) => service.name === name)!.id;
    const write = await tokenFor("ana", "WRITE");
    const open = (body: unknown, token = write) => postRequest(call("/api/v1/requests", token, { method: "POST", body }));

    expect(await read(await open({ serviceId: serviceId("Criação de conta de acesso"), description: "x" }, await tokenFor("ana", "READ")))).toMatchObject({
      status: 403,
      body: { error: { code: "insufficient_scope" } },
    });
    expect(await read(await open({ serviceId: serviceId("Solicitação de férias"), description: "Férias em janeiro" }))).toMatchObject({
      status: 422,
      body: { error: { code: "documents_required" } },
    });
    expect((await read(await open({ serviceId: serviceId("Criação de conta de acesso"), description: "x", requesterId: "outra" }))).status).toBe(400);
    expect((await read(await postRequest(call("/api/v1/requests", write, { method: "POST", raw: "{não é json" })))).status).toBe(400);

    const missingFields = await read(await open({ serviceId: serviceId("Manutenção de ar-condicionado"), description: "Pingando" }));
    expect(missingFields.status).toBe(400);
    expect(missingFields.body.error.fields.map((field: { code: string }) => field.code)).toEqual(["required", "required"]);

    const before = await prisma.outboxEvent.count({ where: { type: "request.opened" } });
    const created = await read(await open({ serviceId: serviceId("Criação de conta de acesso"), description: "Conta para a nova analista" }));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: "OPEN", description: "Conta para a nova analista", service: { name: "Criação de conta de acesso" } });
    await expect(prisma.outboxEvent.count({ where: { type: "request.opened" } })).resolves.toBe(before + 1);
    expect(schedule.scheduleEventProcessing).toHaveBeenCalledTimes(1);

    expect(await read(await open({ serviceId: serviceId("Criação de conta de acesso"), description: "x" }, await tokenFor("diego")))).toMatchObject({
      status: 403,
      body: { error: { code: "forbidden" } },
    });
  });

  it("comments with the rules of the conversation (CA-API-06)", async () => {
    const declaration = await requestOf("Declaração para apresentar no banco até sexta-feira.");
    const comment = (person: Person, body: unknown) =>
      tokenFor(person).then((token) => postComment(call(`/api/v1/requests/${declaration.id}/comments`, token, { method: "POST", body }), params(declaration.id)));

    expect(await read(await comment("ana", { body: "Alguma novidade?" }))).toMatchObject({
      status: 201,
      body: { body: "Alguma novidade?", internal: false, author: { name: "Ana Souza" } },
    });
    expect((await read(await comment("ana", { body: "Nota", internal: true }))).status).toBe(400);
    expect(await read(await comment("diego", { body: "Só para a equipe", internal: true }))).toMatchObject({ status: 201, body: { internal: true } });
    expect((await read(await comment("paulo", { body: "Oi" }))).status).toBe(404);
    expect((await read(await comment("bruno", { body: "Oi" }))).status).toBe(404);
  });

  it("answers 429 with Retry-After after 60 calls in the minute (CA-API-08)", async () => {
    const value = await tokenFor("ana", "READ");
    const token = await prisma.apiToken.findFirstOrThrow({ where: { name: "ana READ" }, orderBy: { createdAt: "desc" } });
    await prisma.apiRateWindow.create({ data: { tokenId: token.id, windowStart: rateWindowStart(new Date()), count: 60 } });

    const response = await getMe(call("/api/v1/me", value));
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(await read(response)).toMatchObject({ status: 429, body: { error: { code: "rate_limited" } } });
  });
});
