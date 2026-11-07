import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { ENTRANCE } from "./entrance";
import { seedDemoData } from "../../scripts/demo-data";

// SPEC 2026-11-07-operacao-e-automacao, section 8, part A (SF-179; CA-VNC-06 through the screens): the
// requester opens a bundle of two services; the attendant starts one and sees the other in the
// "Pacote" block; the requester follows the bundle and cancels it: only the open request is
// cancelled, and the page says the other stays as it is.

const unique = `e2e-grupo-${Date.now()}`;

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

test("following a bundle: progress, the 'Pacote' block and the cancellation", async ({ page }) => {
  test.setTimeout(240_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  const names = { first: `${unique} Acesso`, second: `${unique} Mesa`, bundle: `${unique} Admissão` };
  try {
    await seedDemoData(database);
    const sector = await database.sector.findFirstOrThrow({ where: { name: "Central de Serviços" } });
    const category = await database.category.findFirstOrThrow({ where: { isActive: true } });
    const base = { categoryId: category.id, sectorId: sector.id, description: "Serviço do pacote." };
    const first = await database.service.create({ data: { ...base, name: names.first } });
    const second = await database.service.create({ data: { ...base, name: names.second } });
    await database.serviceBundle.create({ data: { name: names.bundle, serviceIds: [first.id, second.id] } });
  } finally {
    await database.$disconnect();
  }

  // The requester opens the bundle.
  await enterAs(page, "Solicitante");
  await page.goto("/catalog");
  await page.getByRole("region", { name: "Pacotes" }).getByRole("link", { name: names.bundle }).click();
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Descreva o que você precisa").fill(`${unique} primeiro dia`);
  await page.getByRole("button", { name: "Enviar pacote" }).click();
  await expect(page.getByRole("status")).toContainText("Seu pacote foi aberto");
  await page.getByRole("link", { name: "Acompanhar o pacote" }).click();
  await expect(page.getByRole("heading", { name: names.bundle, level: 1 })).toBeVisible();
  await expect(page.locator("article")).toContainText("0 de 2 concluídas");
  const groupUrl = page.url();
  const ids = await page.locator("ol.content-list a").evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).pathname.split("/").at(-1)!));
  expect(ids).toHaveLength(2);
  await signOut(page);

  // The attendant starts the first one and sees the second in the "Pacote" block.
  await enterAs(page, "Atendente");
  await page.goto(`/queue/${ids[0]}`);
  await page.getByRole("button", { name: "Iniciar atendimento" }).click();
  const block = page.getByRole("region", { name: `Pacote: ${names.bundle}` });
  await expect(block).toContainText(names.second);
  await expect(block).toContainText("Aberta");
  await signOut(page);

  // The requester cancels the bundle: only the open request is cancelled.
  await enterAs(page, "Solicitante");
  await page.goto(groupUrl);
  await page.getByLabel("Justificativa (opcional)").fill("A admissão foi adiada.");
  await page.getByRole("button", { name: "Cancelar o pacote" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "1 solicitação cancelada. 1 solicitação continua como estava, porque já está em atendimento ou encerrada.",
  );
  await expect(page.locator("article")).toContainText("0 de 2 concluídas · 1 cancelada");
  await expect(page.getByRole("button", { name: "Cancelar o pacote" })).toHaveCount(0);

  // The list shows "Pacote: …" on the requests of the bundle.
  await page.goto("/requests");
  await expect(page.locator("ul.content-list")).toContainText(`Pacote: ${names.bundle}`);
});
