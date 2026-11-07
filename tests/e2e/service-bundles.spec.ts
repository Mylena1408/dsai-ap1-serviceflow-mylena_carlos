import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { ENTRANCE } from "./entrance";
import { seedDemoData } from "../../scripts/demo-data";

// SPEC 2026-11-07-operacao-e-automacao, section 8, part A (SF-178; CA-VNC-04 and 05 through the
// screens): the administrator creates a bundle of two services; the requester finds it in the
// catalog, fills the description and the field of one service and gets one request per service.
// Refused answers, "all or nothing" and the field errors of every section are covered by the
// integration tests (bundle-opening.test.ts).

const unique = `e2e-pacote-${Date.now()}`;
const bundleName = `${unique} Admissão`;

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

test("bundles: configured by the administrator, opened by the requester", async ({ page }) => {
  test.setTimeout(240_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  const names = { access: `${unique} Acesso`, desk: `${unique} Mesa` };
  try {
    await seedDemoData(database);
    const sector = await database.sector.findFirstOrThrow({ where: { name: "Central de Serviços" } });
    const category = await database.category.findFirstOrThrow({ where: { isActive: true } });
    const base = { categoryId: category.id, sectorId: sector.id, description: "Serviço do pacote." };
    await database.service.create({ data: { ...base, name: names.access } });
    const desk = await database.service.create({ data: { ...base, name: names.desk } });
    await database.serviceField.create({
      data: { serviceId: desk.id, label: "Andar", type: "INTEGER", isRequired: true, options: [], minValue: 1, maxValue: 20, position: 1 },
    });
  } finally {
    await database.$disconnect();
  }

  // The administrator creates the bundle (CA-VNC-04).
  await enterAs(page, "Administrador");
  await page.goto("/admin?section=bundles");
  const create = page.getByRole("form", { name: "Novo pacote" });
  await create.locator('[name="name"]').fill(bundleName);
  await create.locator('[name="description"]').fill("Tudo para o primeiro dia.");
  const selects = create.locator('select[name="serviceIds"]');
  await selects.nth(0).selectOption({ label: `${names.desk} · Central de Serviços` });
  await selects.nth(1).selectOption({ label: `${names.access} · Central de Serviços` });
  await create.getByRole("button", { name: "Criar pacote" }).click();
  await expect(page.locator("p.feedback")).toHaveText("Pacote criado.");
  const card = page.locator("ul.entity-list > li").filter({ hasText: bundleName });
  await expect(card).toContainText(`${names.desk} → ${names.access}`);
  await expect(card).toContainText("No catálogo");
  await signOut(page);

  // The requester opens it from the catalog (CA-VNC-05).
  await enterAs(page, "Solicitante");
  await page.goto("/catalog");
  await page.getByRole("region", { name: "Pacotes" }).getByRole("link", { name: bundleName }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: bundleName, level: 1 })).toBeVisible();
  await page.getByLabel("Descreva o que você precisa").fill(`${unique} primeiro dia`);
  await page.getByLabel("Andar (obrigatório)").fill("7");
  await page.getByRole("button", { name: "Enviar pacote" }).click();

  await expect(page).toHaveURL(/\/requests\?notice=bundle-opened/);
  await expect(page.getByRole("status")).toContainText("Seu pacote foi aberto");
  const list = page.locator("ul.content-list");
  await expect(list).toContainText(names.access);
  await expect(list).toContainText(names.desk);
});
