import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "../../scripts/demo-data";
import { ENTRANCE } from "./entrance";

// SPEC 2026-11-06-analises-operacionais, section 8 (SF-149): the attendant opens "Meu painel", the
// manager opens "Análises" of the own sector, the administrator filters by sector, and the
// requester opens none. Screenshots of each page go to the test output (git-ignored) for review.

const unique = `e2e-analises-${Date.now()}`;
const outsider = `Atendente ${unique}`;
const otherSector = `Setor ${unique}`;

async function enterAs(page: Page, profile: "Administrador" | "Gestor" | "Atendente" | "Solicitante") {
  await page.goto("/");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration
  await page.getByRole("button", { name: `Entrar como ${profile}` }).click();
  await expect(page).not.toHaveURL(ENTRANCE);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(ENTRANCE);
}

test("analytics pages show each profile only its own scope", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  try {
    await seedDemoData(database);
    // Another sector with its own attendant and one pending request, which the demo manager and
    // the demo attendant must never see.
    const sector = await database.sector.create({ data: { name: otherSector } });
    const category = await database.category.create({ data: { name: `Categoria ${unique}` } });
    const service = await database.service.create({ data: { name: `Serviço ${unique}`, description: "E2E", categoryId: category.id, sectorId: sector.id } });
    const attendant = await database.user.create({
      data: { name: outsider, email: `${unique}-atendente@exemplo.test`, role: "ATTENDANT", sectorId: sector.id, passwordHash: "$argon2id$e2e-placeholder-never-used-to-sign-in" },
    });
    const requester = await database.user.create({
      data: { name: `Solicitante ${unique}`, email: `${unique}@exemplo.test`, role: "REQUESTER", passwordHash: "$argon2id$e2e-placeholder-never-used-to-sign-in" },
    });
    const request = await database.request.create({
      data: {
        requesterId: requester.id,
        serviceId: service.id,
        sectorId: sector.id,
        serviceNameSnapshot: service.name,
        serviceDescriptionSnapshot: "E2E",
        categoryIdSnapshot: category.id,
        categoryNameSnapshot: category.name,
        sectorNameSnapshot: sector.name,
        description: "Pedido do outro setor",
        assigneeId: attendant.id,
      },
    });
    await database.requestStatusEvent.create({ data: { requestId: request.id, actorId: requester.id, toStatus: "OPEN" } });
  } finally {
    await database.$disconnect();
  }

  // The attendant: "Meu painel", with the own sector only.
  await enterAs(page, "Atendente");
  await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Meu painel" }).click();
  await expect(page.getByRole("heading", { name: "Meu painel" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fila agora" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Meu período" })).toBeVisible();
  await expect(page.getByText("Central de Serviços · abertas e em atendimento")).toBeVisible();
  await expect(page.getByText("Concluídas por mim")).toBeVisible();
  await expect(page.getByRole("region", { name: "Por prioridade" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(outsider);
  await expect(page.locator("body")).not.toContainText("Desempenho da equipe");
  await page.screenshot({ path: testInfo.outputPath("meu-painel.png"), fullPage: true });
  // The attendant opens neither "Análises".
  await page.goto("/approvals/analytics");
  await expect(page).toHaveURL(/\/queue$/);
  await page.goto("/admin?section=analytics");
  await expect(page).toHaveURL(/\/queue$/);
  await signOut(page);

  // The manager: "Análises" of the own sector, without a sector filter nor other sectors' people.
  await enterAs(page, "Gestor");
  await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Análises" }).click();
  await expect(page.getByRole("heading", { name: "Análises do setor" })).toBeVisible();
  for (const heading of ["Tendências", "SLA e tempos", "Desempenho da equipe"]) {
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
  await expect(page.getByText("Central de Serviços · de")).toBeVisible();
  await expect(page.locator("#analytics-sector")).toHaveCount(0);
  await expect(page.getByText("Use estes números para distribuir o trabalho.")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(outsider);
  await expect(page.getByRole("img", { name: "Abertas e concluídas" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("analises-gestor.png"), fullPage: true });

  // On a phone the page never scrolls sideways; only the hour grid scrolls inside its box (5.7).
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Análises do setor" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: testInfo.outputPath("analises-gestor-celular.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await signOut(page);

  // The administrator: the whole organization, then one sector, then a weekly period.
  await enterAs(page, "Administrador");
  await page.getByRole("navigation", { name: "Seções administrativas" }).getByRole("link", { name: "Análises", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Análises", exact: true })).toBeVisible();
  const team = page.getByRole("region", { name: "Desempenho da equipe" }).or(page.locator("section[aria-labelledby=analytics-team]"));
  await expect(team).toContainText(outsider);
  await expect(team).toContainText(otherSector);
  await page.locator("#analytics-sector").selectOption({ label: otherSector });
  await page.getByRole("button", { name: "Aplicar" }).click();
  await expect(page).toHaveURL(/section=analytics/);
  await expect(page.getByText(`${otherSector} · de`)).toBeVisible();
  await expect(team).toContainText(outsider);
  await page.locator("#analytics-period").selectOption("90");
  await page.getByRole("button", { name: "Aplicar" }).click();
  await expect(page.getByText("Por semana (segunda a domingo).")).toBeVisible();
  await page.goto("/admin?section=analytics&period=30");
  await page.screenshot({ path: testInfo.outputPath("analises-admin.png"), fullPage: true });
  await signOut(page);

  // The requester opens none of the pages.
  await enterAs(page, "Solicitante");
  for (const path of ["/queue/dashboard", "/approvals/analytics", "/admin?section=analytics"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/catalog$/);
  }
});
