import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "../../scripts/demo-data";
import { ENTRANCE } from "./entrance";

// SPEC 2026-11-03-api-acoes-webhooks-setor, section 8 (SF-119): an attendant with a token assumes,
// starts and completes a request through the API, and the screen shows the history; the
// administrator marks a sector on a webhook, and only that sector's events reach the receiver; a
// delivery that did not arrive is resent from the screen and arrives with the same identifier.
//
// The delivery to resend is a cancelled one (the receiver fails, the administrator deactivates and
// reactivates the webhook): reaching "failed" takes 6 attempts spread over hours. Resending a
// failed delivery is covered by tests/integration/webhook-sectors.test.ts.

const unique = `e2e-acoes-${Date.now()}`;
const demoAttendant = "Diego Rocha";

interface Delivery {
  headers: IncomingHttpHeaders;
  body: string;
}

let receiver: Server;
let receiverUrl = "";
let answer = 204;
const deliveries: Delivery[] = [];

test.beforeAll(async () => {
  receiver = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      deliveries.push({ headers: request.headers, body });
      response.writeHead(answer).end();
    });
  });
  await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
  receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/serviceflow`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => receiver.close(() => resolve()));
  // The demonstration people keep their tokens between tests: revoke this test's tokens so the
  // other specs find only their own.
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  try {
    const tokens = await database.apiToken.findMany({ where: { name: { startsWith: unique }, revokedAt: null }, select: { id: true, userId: true } });
    for (const token of tokens) {
      // Revoked by the owner, as on the "Acesso à API" page.
      await database.apiToken.update({ where: { id: token.id }, data: { revokedAt: new Date(), revokedById: token.userId } });
    }
  } finally {
    await database.$disconnect();
  }
});

async function enterAs(page: Page, profile: "Administrador" | "Solicitante" | "Atendente") {
  await page.goto("/");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration
  await page.getByRole("button", { name: `Entrar como ${profile}` }).click();
  await expect(page).not.toHaveURL(ENTRANCE);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(ENTRANCE);
}

async function createToken(page: Page, name: string): Promise<string> {
  await page.goto("/account/api-tokens");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Nome").fill(name);
  await page.getByLabel("Escopo").selectOption("WRITE");
  await page.getByRole("button", { name: "Criar token" }).click();
  const token = await page.locator("input.api-token-value").inputValue();
  expect(token).toMatch(/^sf_/);
  return token;
}

function eventsOf(requestId: string): string[] {
  return deliveries.filter((item) => JSON.parse(item.body).requestId === requestId).map((item) => String(item.headers["serviceflow-event"]));
}

async function open(api: APIRequestContext, token: string, serviceId: string, text: string): Promise<string> {
  const created = await api.post("/api/v1/requests", { headers: { authorization: `Bearer ${token}` }, data: { serviceId, description: text } });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { id: string }).id;
}

test("attendance through the API, a webhook filtered by sector and a resent delivery", async ({ page, playwright }) => {
  test.setTimeout(240_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  let demoService: { id: string; sectorName: string };
  let otherServiceId: string;
  try {
    await seedDemoData(database);
    const service = await database.service.findFirstOrThrow({ where: { name: "Reparo de mobiliário" }, include: { sector: true } });
    demoService = { id: service.id, sectorName: service.sector.name };
    // A second sector, with no attendant: its events must not reach the webhook.
    const sector = await database.sector.create({ data: { name: `${unique} setor` } });
    const category = await database.category.create({ data: { name: `${unique} categoria` } });
    otherServiceId = (
      await database.service.create({
        data: { name: `${unique} serviço`, description: "Serviço de outro setor.", categoryId: category.id, sectorId: sector.id },
      })
    ).id;
  } finally {
    await database.$disconnect();
  }

  // The administrator registers a webhook only for the demonstration sector (CA-ACT-06).
  await enterAs(page, "Administrador");
  await page.goto("/admin?section=webhooks");
  await page.waitForLoadState("networkidle");
  const section = page.getByRole("region", { name: "Webhooks" });
  await section.getByLabel("Nome").first().fill(`${unique} receptor`);
  await section.getByLabel("Endereço (https)").first().fill(receiverUrl);
  await section.getByLabel("Solicitação aberta").first().check();
  await section.getByLabel("Mudança de status").first().check();
  await section.getByLabel(demoService!.sectorName, { exact: true }).first().check();
  await section.getByRole("button", { name: "Criar webhook" }).click();
  await expect(page.locator("input.webhook-secret-value")).toHaveValue(/^whsec_/);
  await page.goto("/admin?section=webhooks");
  await expect(page.locator("ul.webhook-list")).toContainText(`${unique} receptor`);
  await expect(page.locator("ul.webhook-list > li").filter({ hasText: `${unique} receptor` })).toContainText(demoService!.sectorName);
  await signOut(page);

  // The requester opens one request in each sector through the API.
  await enterAs(page, "Solicitante");
  const requesterToken = await createToken(page, `${unique} solicitante`);
  await signOut(page);
  const api = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3100" });
  const inSector = await open(api, requesterToken, demoService!.id, `${unique} cadeira sem encosto`);
  const elsewhere = await open(api, requesterToken, otherServiceId!, `${unique} pedido de outro setor`);

  // The attendant assumes, starts and completes it through the API (CA-ACT-02).
  await enterAs(page, "Atendente");
  const attendantToken = await createToken(page, `${unique} atendente`);
  const headers = { authorization: `Bearer ${attendantToken}` };
  expect((await api.post(`/api/v1/requests/${inSector}/assume`, { headers })).status()).toBe(200);
  expect((await api.post(`/api/v1/requests/${inSector}/start`, { headers })).status()).toBe(200);
  const completed = await api.post(`/api/v1/requests/${inSector}/complete`, { headers, data: {} });
  expect(completed.status()).toBe(200);
  expect(await completed.json()).toMatchObject({ id: inSector, status: "COMPLETED" });

  // The screen shows the same history as an attendance made on it.
  await page.goto(`/queue/${inSector}`);
  const history = page.locator("ol.history-list > li");
  await expect(history.nth(0)).toContainText("Solicitação aberta: Aberta");
  await expect(history.nth(1)).toContainText(`Assumida por ${demoAttendant}`);
  await expect(history.nth(2)).toContainText("Aberta → Em atendimento");
  await expect(history.nth(3)).toContainText("Em atendimento → Concluída");
  await signOut(page);

  // Only the demonstration sector's events reach the receiver (CA-ACT-06).
  await expect
    .poll(() => eventsOf(inSector), { timeout: 30_000 })
    .toEqual(["request.opened", "request.status_changed", "request.status_changed"]);
  expect(eventsOf(elsewhere)).toEqual([]);

  // The receiver fails: the next delivery stays pending with the error.
  answer = 500;
  const failing = await open(api, requesterToken, demoService!.id, `${unique} mesa bamba`);
  await expect.poll(() => eventsOf(failing), { timeout: 30_000 }).toEqual(["request.opened"]);
  const firstTry = deliveries.find((item) => JSON.parse(item.body).requestId === failing)!;
  await api.dispose();

  // Deactivating cancels it; after reactivating, the administrator resends it (CA-ACT-07).
  await enterAs(page, "Administrador");
  await page.goto("/admin?section=webhooks");
  await page.waitForLoadState("networkidle");
  const webhook = page.locator("ul.webhook-list > li").filter({ hasText: `${unique} receptor` });
  await webhook.getByRole("button", { name: "Desativar" }).click();
  await page.waitForLoadState("networkidle");
  await page.locator("ul.webhook-list > li").filter({ hasText: `${unique} receptor` }).getByRole("button", { name: "Reativar" }).click();
  await page.waitForLoadState("networkidle");
  const cancelled = page.locator("ul.webhook-deliveries > li").filter({ hasText: `Cancelada · Solicitação aberta · ${unique} receptor` });
  await expect(cancelled).toHaveCount(1);
  await expect(cancelled).toContainText("resposta 500");

  answer = 204;
  await cancelled.getByRole("button", { name: "Reenviar" }).click();
  await expect(page.getByText("Entrega reenviada. Ela sai logo em seguida.")).toBeVisible();
  await expect.poll(() => eventsOf(failing), { timeout: 30_000 }).toEqual(["request.opened", "request.opened"]);
  const resent = deliveries.filter((item) => JSON.parse(item.body).requestId === failing)[1]!;
  expect(resent.headers["serviceflow-delivery"]).toBe(firstTry.headers["serviceflow-delivery"]);
  expect(resent.body).toBe(firstTry.body);

  await page.goto("/admin?section=webhooks");
  await expect(page.locator("ul.webhook-deliveries > li").filter({ hasText: `Cancelada · Solicitação aberta · ${unique} receptor` })).toHaveCount(0);
});
