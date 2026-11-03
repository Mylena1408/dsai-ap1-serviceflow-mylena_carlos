import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./fixtures";

vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});
const schedule = vi.hoisted(() => ({ scheduleEventProcessing: vi.fn() }));
vi.mock("@/server/jobs/schedule", () => schedule);

import { generateApiToken } from "@/modules/api-tokens";
import { loadDemoData } from "@/modules/demo";
import {
  getTransferCandidates,
  postAssume,
  postCancel,
  postComplete,
  postRelease,
  postReopen,
  postStart,
  postTransfer,
} from "@/modules/public-api";

// SPEC 2026-11-03-api-acoes-webhooks-setor, 5.1 (SF-117; CA-ACT-02 to 05): every action through the
// API follows the rules of the screen, with the token owner as the user of the use cases.

const emails = { ana: "ana.souza@exemplo.test", bruno: "bruno.lima@exemplo.test", diego: "diego.rocha@exemplo.test", paulo: "paulo.ribeiro@exemplo.test" };
type Person = keyof typeof emails;
type Handler = (request: Request, context: { params: Promise<{ requestId: string }> }) => Promise<Response>;

async function tokenFor(person: Person, scope: "READ" | "WRITE" = "WRITE"): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: emails[person] } });
  const token = generateApiToken();
  const now = new Date();
  await prisma.apiToken.create({
    data: { userId: user.id, name: `${person} ${scope}`, scope, tokenHash: token.hash, lastFour: token.lastFour, createdAt: now, expiresAt: new Date(now.getTime() + 86_400_000) },
  });
  return token.value;
}

async function act(handler: Handler, requestId: string, token: string, body?: unknown, method = "POST") {
  const response = await handler(
    new Request(`https://serviceflow.test/api/v1/requests/${requestId}/action`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ requestId }) },
  );
  return { status: response.status, body: await response.json() };
}

const requestOf = (description: string) => prisma.request.findFirstOrThrow({ where: { description } });

describe("actions through the API (SF-117)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await loadDemoData(prisma);
  });

  it("assumes, starts and completes with the same history and events as the screen (CA-ACT-02)", async () => {
    const diego = await tokenFor("diego");
    const request = await requestOf("Lâmpada queimada no corredor do segundo andar.");
    const events = () => prisma.outboxEvent.count({ where: { requestId: request.id } });
    const before = await events();

    expect(await act(postAssume, request.id, diego)).toMatchObject({ status: 200, body: { status: "OPEN", assignee: { name: "Diego Rocha" } } });
    expect(await act(postStart, request.id, diego)).toMatchObject({ status: 200, body: { status: "IN_PROGRESS" } });
    const done = await act(postComplete, request.id, diego);
    expect(done).toMatchObject({ status: 200, body: { status: "COMPLETED" } });
    expect(done.body.history.status.map((event: { to: string }) => event.to)).toEqual(["OPEN", "IN_PROGRESS", "COMPLETED"]);
    expect(done.body.history.assignment).toHaveLength(1);
    await expect(events()).resolves.toBeGreaterThan(before);
    expect(schedule.scheduleEventProcessing).toHaveBeenCalledTimes(3);

    // Repeating an action already done is a conflict, as on the screen (W4).
    expect(await act(postStart, request.id, diego)).toMatchObject({ status: 409, body: { error: { code: "conflict" } } });
  });

  it("answers in the v1 format: scope, profile, state and reading (CA-ACT-04)", async () => {
    const open = await requestOf("Lâmpada queimada no corredor do segundo andar.");
    const pending = await requestOf("Notebook para as reuniões fora do escritório.");

    expect(await act(postStart, open.id, await tokenFor("diego", "READ"))).toMatchObject({ status: 403, body: { error: { code: "insufficient_scope" } } });
    // Ana reads her own requests but does not attend them: the rule of the screen answers "not found"
    // to anyone who is not an attendant of the sector (SPEC principal, seção 10).
    const anas = await requestOf("Conta de acesso para o estagiário que começa na segunda-feira.");
    expect(await act(postStart, anas.id, await tokenFor("ana"))).toMatchObject({ status: 404, body: { error: { code: "not_found" } } });
    // Ana cannot read Carla's request.
    expect(await act(postCancel, open.id, await tokenFor("ana"), {})).toMatchObject({ status: 404, body: { error: { code: "not_found" } } });
    // The pending approval blocks the start.
    expect(await act(postStart, pending.id, await tokenFor("diego"))).toMatchObject({ status: 409 });
    expect((await act(postStart, "nao-e-id", await tokenFor("diego"))).status).toBe(400);
    expect((await act(postAssume, open.id, await tokenFor("diego"), { extra: true })).status).toBe(400);
  });

  it("cancels and reopens with the rules of the screen (CA-ACT-03)", async () => {
    const ana = await tokenFor("ana");
    const diego = await tokenFor("diego");
    const anas = await requestOf("Conta de acesso para o estagiário que começa na segunda-feira.");

    expect(await act(postCancel, anas.id, ana)).toMatchObject({ status: 200, body: { status: "CANCELLED" } });
    expect((await act(postCancel, anas.id, ana)).status).toBe(409);

    const brunos = await requestOf("Fui bloqueado no sistema de compras após três tentativas.");
    expect((await act(postCancel, brunos.id, diego, {})).status).toBe(400);
    expect(await act(postCancel, brunos.id, diego, { note: "Pedido feito por outro canal" })).toMatchObject({
      status: 200,
      body: { status: "CANCELLED", history: { status: [{ to: "OPEN" }, { to: "CANCELLED", note: "Pedido feito por outro canal" }] } },
    });

    // A request completed now can be reopened by its requester, with a reason.
    const declaration = await requestOf("Declaração para apresentar no banco até sexta-feira.");
    expect((await act(postComplete, declaration.id, diego)).status).toBe(200);
    expect((await act(postReopen, declaration.id, ana, {})).status).toBe(400);
    expect(await act(postReopen, declaration.id, ana, { note: "Faltou a assinatura" })).toMatchObject({ status: 200, body: { status: "OPEN" } });
    // More than 7 days after completion it cannot.
    const old = await requestOf("A tomada ao lado da minha mesa não está funcionando.");
    expect((await act(postReopen, old.id, ana, { note: "Voltou a falhar" })).status).toBe(409);
  });

  it("lists who can receive a transfer and transfers within the sector (CA-ACT-02, 05)", async () => {
    const diego = await prisma.user.findUniqueOrThrow({ where: { email: emails.diego } });
    const colleague = await prisma.user.create({
      data: { name: "Eva Lopes", email: "eva@exemplo.test", role: "ATTENDANT", sectorId: diego.sectorId, passwordHash: "!teste" },
    });
    const token = await tokenFor("diego");
    const declaration = await requestOf("Declaração para apresentar no banco até sexta-feira.");

    expect(await act(getTransferCandidates, declaration.id, token, undefined, "GET")).toEqual({
      status: 200,
      body: { items: [{ id: colleague.id, name: "Eva Lopes" }] },
    });
    expect((await act(getTransferCandidates, declaration.id, await tokenFor("ana"), undefined, "GET")).status).toBe(403);
    expect((await act(postTransfer, declaration.id, token, {})).status).toBe(400);
    expect(await act(postTransfer, declaration.id, token, { assigneeId: colleague.id })).toMatchObject({
      status: 200,
      body: { assignee: { id: colleague.id, name: "Eva Lopes" } },
    });
    // Diego is no longer the assignee: he cannot release it.
    expect((await act(postRelease, declaration.id, token)).status).toBe(409);
  });
});
