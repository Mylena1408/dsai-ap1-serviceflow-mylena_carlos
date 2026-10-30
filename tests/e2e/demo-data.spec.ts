import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { DEMO_CATALOG, seedDemoData } from "../../scripts/demo-data";

// SPEC 2026-09-30, sections 22.6 and 22.7 (CA-DEMO-07 and CA-DEMO-08).
test("demonstration data is visible to each profile", async ({ page }) => {
  test.setTimeout(120_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  try {
    await seedDemoData(database);
  } finally {
    await database.$disconnect();
  }

  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Entrar como Solicitante" }).click();
  await expect(page).toHaveURL(/\/catalog/);
  for (const group of DEMO_CATALOG) {
    const category = page.getByRole("region", { name: group.category, exact: true });
    await expect(category).toBeVisible();
    for (const service of group.services) {
      await expect(category.getByRole("link", { name: service.name })).toBeVisible();
    }
  }

  await page.getByRole("link", { name: "Minhas solicitações" }).first().click();
  // The requester list shows the service and status; descriptions appear on the detail page.
  for (const service of ["Solicitação de equipamento", "Declaração de vínculo", "Reparo elétrico"]) {
    await expect(page.getByRole("link", { name: service })).toBeVisible();
  }
  for (const status of ["Aberta", "Em atendimento", "Concluída"]) {
    await expect(page.locator(".status-pill", { hasText: status })).toBeVisible();
  }

  const description = `Pedido aberto no E2E ${Date.now()}`;
  await page.goto("/catalog");
  await page.getByRole("link", { name: "Reparo de mobiliário" }).first().click();
  await page.getByLabel("Descreva o que você precisa").fill(description);
  await page.getByRole("button", { name: "Enviar solicitação" }).click();
  await expect(page.getByRole("status")).toHaveText("Sua solicitação foi aberta.");
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.waitForLoadState("networkidle"); // buttons only work after hydration

  await page.getByRole("button", { name: "Entrar como Atendente" }).click();
  await expect(page).toHaveURL(/\/queue/);
  await expect(page.getByText(description)).toBeVisible();
  await expect(page.getByText("Fui bloqueado no sistema de compras após três tentativas.")).toBeVisible();
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.waitForLoadState("networkidle"); // buttons only work after hydration

  await page.getByRole("button", { name: "Entrar como Administrador" }).click();
  await expect(page).toHaveURL(/\/admin/);
  await page
    .getByRole("navigation", { name: "Seções administrativas" })
    .getByRole("link", { name: "Usuários", exact: true })
    .click();
  await expect(page.getByText("ana.souza@exemplo.test")).toBeVisible();
  await page
    .getByRole("navigation", { name: "Seções administrativas" })
    .getByRole("link", { name: "Serviços", exact: true })
    .click();
  await expect(page.getByText("Comprovante de residência")).toBeVisible();
});
