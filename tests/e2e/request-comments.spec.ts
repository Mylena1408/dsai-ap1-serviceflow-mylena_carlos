import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "../../scripts/demo-data";

// SPEC 2026-10-31-comentarios, section 9 (SF-056).

const unique = `e2e-com-${Date.now()}`;
const question = `${unique} Qual o prazo para o conserto?`;
const answer = `${unique} Até sexta-feira.`;
const internalNote = `${unique} Peça encomendada; avisar o almoxarifado.`;
const markup = `${unique} <b>texto</b>`;

async function enterAs(page: Page, profile: "Solicitante" | "Atendente") {
  await page.goto("/login");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration
  await page.getByRole("button", { name: `Entrar como ${profile}` }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login/);
}

async function openRequest(page: Page, description: string): Promise<string> {
  await page.goto("/catalog");
  await page.getByRole("link", { name: "Reparo de mobiliário" }).first().click();
  await page.getByLabel("Descreva o que você precisa").fill(description);
  await page.getByRole("button", { name: "Enviar solicitação" }).click();
  await expect(page.getByRole("status")).toHaveText("Sua solicitação foi aberta.");
  return new URL(page.url()).pathname.split("/").at(-1)!;
}

async function comment(page: Page, text: string, internal = false) {
  await page.getByLabel("Novo comentário").fill(text);
  if (internal) await page.getByLabel("Nota interna (o solicitante não vê)").check();
  await page.getByRole("button", { name: "Enviar comentário" }).click();
  await expect(page.locator("p.feedback")).toHaveText("Comentário enviado.");
}

test("requester and attendant talk; internal notes stay inside the team", async ({ page }) => {
  test.setTimeout(180_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  try {
    await seedDemoData(database);
  } finally {
    await database.$disconnect();
  }

  // Requester asks a question; markup is shown as text (CA-COM-01, 08).
  await enterAs(page, "Solicitante");
  const requestId = await openRequest(page, `${unique} mesa bamba`);
  await comment(page, question);
  await comment(page, markup);
  const conversation = page.getByRole("region", { name: "Conversa" });
  await expect(conversation.getByText(markup, { exact: true })).toBeVisible();
  await expect(conversation.locator("b")).toHaveCount(0);
  await expect(page.getByLabel("Nota interna (o solicitante não vê)")).toHaveCount(0);

  // A cancelled request keeps the conversation read-only (CA-COM-04).
  const cancelledId = await openRequest(page, `${unique} pedido cancelado`);
  await page.getByText("Cancelar solicitação").click();
  await page.getByRole("button", { name: "Confirmar cancelamento" }).click();
  await expect(page.getByText("Esta solicitação foi cancelada; a conversa está encerrada.")).toBeVisible();
  await expect(page.getByLabel("Novo comentário")).toHaveCount(0);
  await signOut(page);

  // Attendant sees the question, answers and leaves an internal note (CA-COM-02, 05).
  await enterAs(page, "Atendente");
  await page.goto(`/queue/${requestId}`);
  await expect(page.getByText(question)).toBeVisible();
  await comment(page, answer);
  await comment(page, internalNote, true);
  await expect(page.getByText("Nota interna (só atendentes)")).toBeVisible();
  await page.goto(`/queue?q=${encodeURIComponent(unique)}`);
  const queueItem = page.locator("ul.content-list > li").filter({ hasText: `${unique} mesa bamba` });
  await expect(queueItem).toContainText("4 comentários");
  await page.goto(`/queue/${cancelledId}`);
  await expect(page.getByLabel("Novo comentário")).toHaveCount(0);
  await signOut(page);

  // Requester sees the answer, never the note, and counts only public comments.
  await enterAs(page, "Solicitante");
  await page.goto(`/requests/${requestId}`);
  const items = page.getByRole("region", { name: "Conversa" }).locator("li");
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText(question);
  await expect(items.nth(2)).toContainText(answer);
  await expect(items.nth(2)).toContainText("(atendente)");
  await expect(page.getByText(internalNote)).toHaveCount(0);
  await expect(page.getByText("Nota interna")).toHaveCount(0);
  expect(await page.content()).not.toContain(internalNote);
  await page.goto("/requests");
  // The list shows service and status, so the item is found by its link to this request.
  const listItem = page.locator("ul.content-list > li").filter({ has: page.locator(`a[href="/requests/${requestId}"]`) });
  await expect(listItem).toContainText("3 comentários");
});
