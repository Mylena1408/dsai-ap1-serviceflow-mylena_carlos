import { createHmac } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "../../scripts/demo-data";
import { ENTRANCE } from "./entrance";

// SPEC 2026-11-02-api-externa-webhooks, section 8 (SF-115): the administrator registers a webhook
// for a receiver run by this test; the requester creates a token on the screen; the test opens a
// request through the API; it appears on the screen and in the attendant's queue, and the receiver
// gets the "request.opened" event with a valid signature; after the revocation, the API answers 401.

const unique = `e2e-api-${Date.now()}`;
const description = `${unique} cadeira da sala 3 sem rodinha`;

interface Delivery {
  headers: IncomingHttpHeaders;
  body: string;
}

let receiver: Server;
let receiverUrl = "";
const deliveries: Delivery[] = [];

test.beforeAll(async () => {
  receiver = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      deliveries.push({ headers: request.headers, body });
      response.writeHead(204).end();
    });
  });
  await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
  receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/serviceflow`;
});

test.afterAll(() => new Promise<void>((resolve) => receiver.close(() => resolve())));

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

test("a token from the screen opens a request through the API, and a webhook receives it signed", async ({ page, playwright }) => {
  test.setTimeout(180_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  let serviceId: string;
  try {
    await seedDemoData(database);
    serviceId = (await database.service.findFirstOrThrow({ where: { name: "Reparo de mobiliário" } })).id;
  } finally {
    await database.$disconnect();
  }

  // The administrator registers a webhook for the opening of requests (CA-API-10).
  await enterAs(page, "Administrador");
  await page.goto("/admin?section=webhooks");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Webhooks configurados.")).toBeVisible();
  const section = page.getByRole("region", { name: "Webhooks" });
  await section.getByLabel("Nome").first().fill(`${unique} receptor`);
  await section.getByLabel("Endereço (https)").first().fill(receiverUrl);
  await section.getByLabel("Solicitação aberta").first().check();
  await section.getByRole("button", { name: "Criar webhook" }).click();
  const secret = await page.locator("input.webhook-secret-value").inputValue();
  expect(secret).toMatch(/^whsec_/);
  await signOut(page);

  // The requester creates a token; its value appears once.
  await enterAs(page, "Solicitante");
  await page.getByRole("link", { name: "Acesso à API" }).click();
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Nome").fill(`${unique} token`);
  await page.getByLabel("Escopo").selectOption("WRITE");
  await page.getByRole("button", { name: "Criar token" }).click();
  const token = await page.locator("input.api-token-value").inputValue();
  expect(token).toMatch(/^sf_/);

  // A client without the browser's cookies opens a request with the token (CA-API-06).
  const api = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3100" });
  const headers = { authorization: `Bearer ${token}` };
  const created = await api.post("/api/v1/requests", { headers, data: { serviceId: serviceId!, description } });
  expect(created.status()).toBe(201);
  expect(created.headers()["cache-control"]).toBe("no-store");
  const request = (await created.json()) as { id: string; status: string };
  expect(request.status).toBe("OPEN");

  // It is on the requester's screen: in her list and with the description on the detail page.
  await page.goto(`/requests?q=${encodeURIComponent(unique)}`);
  await expect(page.locator("ul.content-list > li")).toHaveCount(1);
  await page.goto(`/requests/${request.id}`);
  await expect(page.getByText(description)).toBeVisible();

  // The receiver gets the opening, signed with the secret shown once (CA-API-11).
  await expect.poll(() => deliveries.length, { timeout: 30_000 }).toBeGreaterThan(0);
  const delivery = deliveries.find((item) => JSON.parse(item.body).requestId === request.id)!;
  expect(delivery.headers["serviceflow-event"]).toBe("request.opened");
  const [, timestamp, digest] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(String(delivery.headers["serviceflow-signature"]))!;
  expect(createHmac("sha256", secret).update(`${timestamp}.${delivery.body}`).digest("hex")).toBe(digest);
  expect(Math.abs(Date.now() / 1000 - Number(timestamp))).toBeLessThan(300);
  expect(JSON.parse(delivery.body)).toMatchObject({ type: "request.opened", requestId: request.id });
  expect(delivery.body).not.toContain(description);

  // The requester revokes the token; the next call is refused (CA-API-03).
  await page.goto("/account/api-tokens");
  await page.getByRole("button", { name: "Revogar" }).click();
  await expect(page.getByText("Token revogado. Ele deixa de funcionar na próxima chamada.")).toBeVisible();
  const refused = await api.get("/api/v1/me", { headers });
  expect(refused.status()).toBe(401);
  expect(await refused.json()).toEqual({ error: { code: "invalid_token", message: "The token is missing, invalid, expired or revoked." } });
  await api.dispose();
  await signOut(page);

  // The attendant sees the request opened through the API in the sector queue.
  await enterAs(page, "Atendente");
  await page.goto(`/queue?q=${encodeURIComponent(unique)}`);
  await expect(page.getByText(description)).toBeVisible();
  await signOut(page);

  // The administrator follows the delivery, without its body.
  await enterAs(page, "Administrador");
  await page.goto("/admin?section=webhooks");
  await expect(page.locator("ul.webhook-deliveries")).toContainText(`Entregue · Solicitação aberta · ${unique} receptor`);
  await expect(page.locator("body")).not.toContainText(description);
});
