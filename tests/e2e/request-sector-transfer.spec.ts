import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "../../scripts/demo-data";
import { generateApiToken } from "../../src/modules/api-tokens/domain/token";
import { ENTRANCE } from "./entrance";

// SPEC 2026-11-03-transferencia-entre-setores, section 8 (SF-123): the attendant sends a request to a
// second sector from the screen; the first sector stops seeing it; the attendant of the second sector
// reads it with the whole history and the internal notes and is notified; the requester sees the new
// sector.
//
// The demonstration signs in only as its fictitious people, and each click restores the person's
// account, sector included (SPEC 2026-09-30, section 22), so nobody of the demonstration can be
// placed in the second sector. The test creates that sector with an attendant who cannot sign in on
// the screen and reads the request through the API with a token of that attendant (SF-122), which
// uses the same reading rules as the queue.

const unique = `e2e-setor-${Date.now()}`;
const description = `${unique} armário da copa sem porta`;
const internalNote = `${unique} nota interna da central`;
const reason = "Conserto de armário é com a marcenaria";

async function enterAs(page: Page, profile: "Solicitante" | "Atendente") {
  await page.goto("/");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration
  await page.getByRole("button", { name: `Entrar como ${profile}` }).click();
  await expect(page).not.toHaveURL(ENTRANCE);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(ENTRANCE);
}

test("an attendant sends a request to another sector, which receives it with its history", async ({ page, playwright }) => {
  test.setTimeout(240_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  let colleagueToken: string;
  let colleagueId: string;
  let demoSectorName: string;
  let target: { id: string; name: string };

  try {
    await seedDemoData(database);
    const diego = await database.user.findUniqueOrThrow({ where: { email: "diego.rocha@exemplo.test" }, include: { sector: true } });
    demoSectorName = diego.sector!.name;
    target = await database.sector.create({ data: { name: `${unique} Marcenaria` } });
    const colleague = await database.user.create({
      data: { name: `${unique} Técnico`, email: `${unique}@exemplo.test`, role: "ATTENDANT", sectorId: target.id, passwordHash: "not-a-usable-hash" },
    });
    colleagueId = colleague.id;
    const token = generateApiToken();
    const now = new Date();
    await database.apiToken.create({
      data: { userId: colleague.id, name: `${unique} leitura`, scope: "READ", tokenHash: token.hash, lastFour: token.lastFour, createdAt: now, expiresAt: new Date(now.getTime() + 86_400_000) },
    });
    colleagueToken = token.value;
  } finally {
    await database.$disconnect();
  }

  // The requester opens a request in the demonstration sector.
  await enterAs(page, "Solicitante");
  await page.goto("/catalog");
  await page.getByRole("link", { name: "Reparo de mobiliário" }).first().click();
  await page.getByLabel("Descreva o que você precisa").fill(description);
  await page.getByRole("button", { name: "Enviar solicitação" }).click();
  await expect(page.getByRole("status")).toHaveText("Sua solicitação foi aberta.");
  const requestId = new URL(page.url()).pathname.split("/").at(-1)!;
  await signOut(page);

  // The attendant writes an internal note, assumes and sends it to the other sector (CA-SET-02).
  await enterAs(page, "Atendente");
  await page.goto(`/queue/${requestId}`);
  await page.getByLabel("Novo comentário").fill(internalNote);
  await page.getByLabel("Nota interna (o solicitante não vê)").check();
  await page.getByRole("button", { name: "Enviar comentário" }).click();
  await expect(page.locator("p.feedback")).toHaveText("Comentário enviado.");
  await page.getByRole("button", { name: "Assumir" }).click();
  await expect(page.locator("p.feedback")).toHaveText("Você assumiu esta solicitação.");

  const form = page.getByRole("region", { name: "Encaminhar para outro setor" });
  await expect(form.getByLabel("Setor de destino").locator("option", { hasText: demoSectorName })).toHaveCount(0);
  await form.getByLabel("Setor de destino").selectOption({ label: target.name });
  await form.getByLabel("Justificativa").fill(reason);
  await form.getByRole("button", { name: "Encaminhar" }).click();
  await expect(page).toHaveURL(/\/queue\?notice=sector-sent$/);
  await expect(page.getByRole("status").filter({ hasText: "Solicitação encaminhada ao outro setor." })).toBeVisible();

  // The first sector no longer sees it (CA-SET-04).
  await page.goto(`/queue?q=${encodeURIComponent(unique)}`);
  await expect(page.getByText(description)).toHaveCount(0);
  const hidden = await page.goto(`/queue/${requestId}`);
  expect(hidden?.status()).toBe(404);
  await signOut(page);

  // The other sector reads it with the whole history and the internal note (CA-SET-04).
  const api = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3100" });
  const read = await api.get(`/api/v1/requests/${requestId}`, { headers: { authorization: `Bearer ${colleagueToken}` } });
  expect(read.status()).toBe(200);
  const detail = await read.json();
  expect(detail).toMatchObject({
    status: "OPEN",
    assignee: null,
    sector: { id: target.id },
    history: {
      sectors: [{ from: { name: demoSectorName }, to: { id: target.id, name: target.name }, actor: { name: "Diego Rocha" }, note: reason }],
      assignment: [{ to: { name: "Diego Rocha" } }, { from: { name: "Diego Rocha" }, to: null }],
    },
  });
  expect(detail.comments).toEqual(expect.arrayContaining([expect.objectContaining({ body: internalNote, internal: true })]));
  await api.dispose();

  // Its attendant is notified (CA-SET-05).
  const check = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  try {
    await expect
      .poll(() => check.requestNotification.count({ where: { requestId, recipientId: colleagueId, type: "sector.received" } }), { timeout: 30_000 })
      .toBe(1);
  } finally {
    await check.$disconnect();
  }

  // The requester sees the new sector and the move, without the internal note.
  await enterAs(page, "Solicitante");
  await page.goto(`/requests/${requestId}`);
  await expect(page.getByText(`Setor responsável: ${target.name}`)).toBeVisible();
  const history = page.locator("ol.history-list");
  await expect(history).toContainText(`Encaminhada do setor ${demoSectorName} para o setor ${target.name}`);
  await expect(history).toContainText(`Justificativa: ${reason}`);
  await expect(page.locator("body")).not.toContainText(internalNote);
});
