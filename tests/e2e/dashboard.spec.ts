import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { ENTRANCE } from "./entrance";
import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "../../scripts/demo-data";

// SPEC 2026-11-02-painel-relatorios, section 8 (SF-101): the administrator opens the dashboard,
// sees the numbers of the demo database, filters by sector and downloads the CSV; the manager
// sees only the own sector; the attendant does not open the dashboard.

const unique = `e2e-painel-${Date.now()}`;

async function enterAs(page: Page, profile: "Administrador" | "Gestor" | "Atendente") {
  await page.goto("/");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration
  await page.getByRole("button", { name: `Entrar como ${profile}` }).click();
  await expect(page).not.toHaveURL(ENTRANCE);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(ENTRANCE);
}

async function downloadCsv(page: Page): Promise<{ name: string; lines: string[] }> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Exportar CSV" }).click(),
  ]);
  const text = await readFile((await download.path())!, "utf8");
  return { name: download.suggestedFilename(), lines: text.replace(/^﻿/, "").split("\r\n").filter(Boolean) };
}

const groupRow = (page: Page, group: string, name: string) =>
  page.getByRole("region", { name: group }).getByRole("row").filter({ has: page.getByRole("rowheader", { name, exact: true }) });

test("the dashboard shows consolidated numbers to the administrator and the manager, and exports a CSV", async ({ page }) => {
  test.setTimeout(180_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  const otherSector = `Outro setor ${unique}`;
  const otherService = `Serviço ${unique}`;
  try {
    await seedDemoData(database);
    // A second sector with one request opened now, which the demo manager must never see.
    const sector = await database.sector.create({ data: { name: otherSector } });
    const category = await database.category.create({ data: { name: `Categoria ${unique}` } });
    const service = await database.service.create({
      data: { name: otherService, description: "Serviço do E2E", categoryId: category.id, sectorId: sector.id },
    });
    // Its own requester, so the demo requester's lists stay as the other tests expect them.
    const requester = await database.user.create({
      data: {
        name: `Solicitante ${unique}`,
        email: `${unique}@exemplo.test`,
        role: "REQUESTER",
        passwordHash: "$argon2id$e2e-placeholder-never-used-to-sign-in",
      },
    });
    await database.request.create({
      data: {
        requesterId: requester.id,
        serviceId: service.id,
        sectorId: sector.id,
        serviceNameSnapshot: service.name,
        serviceDescriptionSnapshot: service.description,
        categoryIdSnapshot: category.id,
        categoryNameSnapshot: category.name,
        sectorNameSnapshot: sector.name,
        description: `${unique} texto que nunca vai para o painel`,
      },
    });
  } finally {
    await database.$disconnect();
  }

  // The administrator sees the whole organization, with the new sector among the groups.
  await enterAs(page, "Administrador");
  await page.goto("/admin");
  await page.getByRole("navigation", { name: "Seções administrativas" }).getByRole("link", { name: "Painel" }).click();
  await expect(page.getByRole("heading", { name: "Painel", exact: true })).toBeVisible();
  await expect(page.getByText("Toda a organização · de")).toBeVisible();
  await expect(groupRow(page, "Por setor", otherSector)).toContainText("1");
  await expect(groupRow(page, "Por setor", "Setor de demonstração")).toBeVisible();
  await expect(page.getByText(unique + " texto")).toHaveCount(0);

  // Filtering by the new sector: one request opened, no sector groups.
  await page.locator("#dashboard-sector").selectOption({ label: otherSector });
  await page.getByRole("button", { name: "Aplicar" }).click();
  await expect(page).toHaveURL(/sector=/);
  await expect(page.getByText(`${otherSector} · de`)).toBeVisible();
  await expect(page.getByRole("region", { name: "Por setor" })).toHaveCount(0);
  const opened = page.locator(".dashboard-indicator").filter({ hasText: "Abertas no período" });
  await expect(opened).toContainText("1");

  // The CSV of that sector has the header and the one request, without its description.
  const csv = await downloadCsv(page);
  expect(csv.name).toMatch(/^serviceflow-solicitacoes-\d{4}-\d{2}-\d{2}-a-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(csv.lines).toHaveLength(2);
  expect(csv.lines[0]).toBe(
    "Código;Serviço;Categoria;Setor;Status;Prioridade;Aprovação;Etapa atual;Responsável;Aberta em;Concluída em;Cancelada em;Vencimento;Situação do prazo;Concluída no prazo",
  );
  expect(csv.lines[1]).toContain(`;${otherService};Categoria ${unique};${otherSector};Aberta;Normal;`);
  expect(csv.lines.join("\n")).not.toContain("nunca vai para o painel");
  expect(csv.lines.join("\n")).not.toContain(`Solicitante ${unique}`);

  // A refused period is explained and the default one is shown.
  await page.goto("/admin?section=dashboard&period=custom&from=2026-10-31&to=2026-10-01");
  await expect(page.getByRole("alert")).toHaveText(
    "A data de início precisa ser anterior ou igual à de fim. Mostrando os últimos 30 dias.",
  );
  await signOut(page);

  // The manager sees only the own sector, even with another sector in the URL.
  await enterAs(page, "Gestor");
  await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Painel do setor" }).click();
  await expect(page.getByRole("heading", { name: "Painel do setor" })).toBeVisible();
  await expect(page.getByText("Setor de demonstração · de")).toBeVisible();
  await expect(page.locator("#dashboard-sector")).toHaveCount(0);
  const managerCsv = await downloadCsv(page);
  expect(managerCsv.lines.length).toBeGreaterThan(1);
  expect(managerCsv.lines.join("\n")).not.toContain(otherSector);
  await signOut(page);

  // The attendant does not open either dashboard.
  await enterAs(page, "Atendente");
  await page.goto("/approvals/dashboard");
  await expect(page).toHaveURL(/\/queue$/);
  await page.goto("/admin?section=dashboard");
  await expect(page).toHaveURL(/\/queue$/);
});
