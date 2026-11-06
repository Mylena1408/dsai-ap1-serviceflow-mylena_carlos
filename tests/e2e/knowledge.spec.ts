import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "../../scripts/demo-data";
import { ENTRANCE } from "./entrance";

// SPEC 2026-11-06-base-conhecimento, section 7 (SF-157): the administrator writes an article for a
// service; the requester does not see the draft, and sees it on the service page once published.

const title = `Antes de pedir férias ${Date.now()}`;
const service = "Solicitação de férias";

async function enterAs(page: Page, profile: "Administrador" | "Solicitante") {
  await page.goto("/");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration
  await page.getByRole("button", { name: `Entrar como ${profile}` }).click();
  await expect(page).not.toHaveURL(ENTRANCE);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(ENTRANCE);
}

test("an article is written as a draft, published, and read by the requester before opening", async ({ page }) => {
  test.setTimeout(180_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  let serviceId: string;
  try {
    await seedDemoData(database);
    serviceId = (await database.service.findFirstOrThrow({ where: { name: service } })).id;
  } finally {
    await database.$disconnect();
  }

  await enterAs(page, "Administrador");
  await page.getByRole("navigation", { name: "Seções administrativas" }).getByRole("link", { name: "Base de conhecimento" }).click();
  await expect(page.getByRole("heading", { name: "Base de conhecimento" })).toBeVisible();
  const item = page.locator("li.entity-item").filter({ hasText: service });
  await item.locator("summary").first().click();
  const form = item.getByRole("form", { name: `Novo artigo de ${service}` });
  await form.getByLabel("Título").fill(title);
  await form.getByLabel(/Texto/).fill("Peça com 30 dias de antecedência.\n\nAnexe o formulário assinado pela chefia.");
  await form.getByRole("button", { name: "Criar rascunho" }).click();
  await expect(page.getByRole("status")).toHaveText("Artigo criado como rascunho.");
  await signOut(page);

  // A draft never reaches the requester.
  await enterAs(page, "Solicitante");
  await page.goto(`/catalog/${serviceId!}`);
  await expect(page.locator("body")).not.toContainText(title);
  await signOut(page);

  await enterAs(page, "Administrador");
  await page.goto("/admin?section=knowledge");
  const reopened = page.locator("li.entity-item").filter({ hasText: service });
  await reopened.locator("summary").first().click();
  await reopened.getByRole("article", { name: title }).getByRole("button", { name: "Publicar" }).click();
  await expect(page.getByRole("status")).toHaveText("Artigo publicado. Os solicitantes já o veem no catálogo.");
  await signOut(page);

  await enterAs(page, "Solicitante");
  await page.goto(`/catalog/${serviceId!}`);
  const block = page.getByRole("region", { name: "Antes de abrir, veja se isto resolve" });
  await block.getByText(title).click();
  await expect(block).toContainText("Peça com 30 dias de antecedência.");
  await expect(block).toContainText("Anexe o formulário assinado pela chefia.");
});
