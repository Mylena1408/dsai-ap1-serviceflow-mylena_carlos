import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "../../scripts/demo-data";

// SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.5 (SF-165; CA-APM-04 through the screen):
// the demonstration manager registers an absence with another manager as substitute, sees it in
// force, is refused an overlapping one and cancels it.

const unique = `e2e-ausencia-${Date.now()}`;

test("manager absences: register, refuse an overlap and cancel", async ({ page }) => {
  test.setTimeout(120_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  try {
    await seedDemoData(database);
    const sector = await database.sector.create({ data: { name: `${unique} Financeiro` } });
    await database.user.create({
      data: { name: `${unique} Fred`, email: `${unique}@example.test`, role: "MANAGER", sectorId: sector.id, passwordHash: "x" },
    });
  } finally {
    await database.$disconnect();
  }

  await page.goto("/");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration
  await page.getByRole("button", { name: "Entrar como Gestor" }).click();
  await expect(page).toHaveURL(/\/approvals$/);

  await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Ausências" }).click();
  await expect(page.getByRole("heading", { name: "Ausências", level: 1 })).toBeVisible();
  const today = await page.locator('input[name="startsOn"]').getAttribute("min");
  expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Registrar ausência" }) });
  await form.getByLabel("Substituto").selectOption({ label: `${unique} Fred (${unique} Financeiro)` });
  await form.getByLabel("Início").fill(today!);
  await form.getByLabel("Fim").fill(today!);
  await form.getByRole("button", { name: "Registrar ausência" }).click();
  await expect(page.getByRole("status")).toHaveText("Ausência registrada.");
  const own = page.getByRole("region", { name: "Minhas ausências" });
  await expect(own).toContainText(`substituto: ${unique} Fred — Em vigor`);

  // The same day again overlaps the first absence.
  await form.getByLabel("Substituto").selectOption({ label: `${unique} Fred (${unique} Financeiro)` });
  await form.getByLabel("Início").fill(today!);
  await form.getByLabel("Fim").fill(today!);
  await form.getByRole("button", { name: "Registrar ausência" }).click();
  await expect(page.locator("p.feedback-error")).toContainText("Não foi possível registrar");

  await own.getByRole("button", { name: "Cancelar ausência" }).first().click();
  await expect(page.getByRole("status")).toHaveText("Ausência cancelada.");
  await expect(own).toContainText("Cancelada");
});
