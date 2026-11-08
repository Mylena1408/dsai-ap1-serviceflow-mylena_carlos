import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { ENTRANCE } from "./entrance";
import { seedDemoData } from "../../scripts/demo-data";

// SPEC 2026-11-07-operacao-e-automacao, section 8, part B (SF-183; CA-DST-02, 03, 05 and 06 through the
// screens): the administrator turns the round-robin on in "Setores"; a second attendant is absent
// today; the requester opens a request and it goes to Diego by itself; the manager sees the team's
// load; the history names the system.

const unique = `e2e-distribuicao-${Date.now()}`;

async function enterAs(page: Page, profile: "Administrador" | "Solicitante" | "Atendente" | "Gestor") {
  await page.goto("/");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration
  await page.getByRole("button", { name: `Entrar como ${profile}` }).click();
  await expect(page).not.toHaveURL(ENTRANCE);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(ENTRANCE);
}

test("distribution: settings, an absent colleague, the automatic assignment and the team's load", async ({ page }) => {
  test.setTimeout(240_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  // "Aline" comes before "Diego" by name: without the absence, the round-robin would pick her.
  const colleague = `Aline ${unique}`;
  let sectorId = "";
  try {
    await seedDemoData(database);
    const sector = await database.sector.findFirstOrThrow({ where: { name: "Central de Serviços" } });
    sectorId = sector.id;
    await database.sector.update({ where: { id: sector.id }, data: { distributionMode: "NONE", maxActivePerAttendant: null, lastDistributedToId: null } });
    // Aline is absent today: the round-robin skips her.
    const aline = await database.user.create({
      data: { name: colleague, email: `${unique}@example.test`, role: "ATTENDANT", sectorId: sector.id, passwordHash: "!e2e-unusable" },
    });
    const today = new Date().toISOString().slice(0, 10);
    const day = new Date(`${today}T00:00:00Z`);
    await database.attendantAbsence.create({
      data: { userId: aline.id, createdById: aline.id, startsOn: new Date(day.getTime() - 86_400_000), endsOn: new Date(day.getTime() + 86_400_000) },
    });
    // A plain service of the sector: no fields, documents or approval.
    const category = await database.category.findFirstOrThrow({ where: { isActive: true } });
    await database.service.create({ data: { name: `${unique} Serviço`, description: "Serviço do teste.", categoryId: category.id, sectorId: sector.id } });
    // Diego starts without held requests, so the limit of 5 is not in the way.
    const diego = await database.user.findUniqueOrThrow({ where: { email: "diego.rocha@exemplo.test" } });
    await database.request.updateMany({ where: { assigneeId: diego.id, status: { in: ["OPEN", "IN_PROGRESS"] } }, data: { assigneeId: null } });
  } finally {
    await database.$disconnect();
  }

  try {
    // The administrator turns the round-robin on, with a limit (CA-DST-02).
    await enterAs(page, "Administrador");
    await page.goto("/admin?section=sectors");
    const settings = page.getByRole("form", { name: "Distribuição de Central de Serviços" });
    await settings.locator('[name="distributionMode"]').selectOption("ROUND_ROBIN");
    await settings.locator('[name="maxActivePerAttendant"]').fill("5");
    await settings.getByRole("button", { name: "Salvar distribuição" }).click();
    await expect(page.locator("p.feedback")).toHaveText("Distribuição salva. Vale para as próximas solicitações que entrarem na fila.");
    await expect(page.locator("li.distribution-row").filter({ hasText: "Central de Serviços" })).toContainText("Rodízio · até 5 por atendente");
    await expect(page.getByRole("table", { name: "Carga de Central de Serviços" })).toContainText("Ausente hoje");
    await signOut(page);

    // The requester opens a request; it goes to Diego by itself (CA-DST-03 and 05).
    await enterAs(page, "Solicitante");
    await page.goto("/catalog");
    await page.getByRole("link", { name: `${unique} Serviço` }).click();
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Descreva o que você precisa").fill(`${unique} pedido`);
    await page.getByRole("button", { name: "Enviar solicitação" }).click();
    await expect(page.getByRole("status")).toHaveText("Sua solicitação foi aberta.");
    const requestId = new URL(page.url()).pathname.split("/").at(-1)!;
    await signOut(page);

    await enterAs(page, "Atendente");
    await page.goto(`/queue/${requestId}`);
    await expect(page.locator("ol.history-list")).toContainText("Distribuída automaticamente a Diego Rocha");
    await expect(page.locator("ol.history-list")).toContainText("Sistema (distribuição automática)");
    await signOut(page);

    // The manager sees the team's load on the sector's dashboard (CA-DST-06).
    await enterAs(page, "Gestor");
    await page.goto("/approvals/dashboard");
    const load = page.getByRole("table", { name: "Carga de Central de Serviços" });
    await expect(load).toContainText("Diego Rocha");
    await expect(load).toContainText(colleague);
    await expect(load).toContainText("Ausente hoje");
  } finally {
    // Later tests of the run start with the distribution off.
    const cleanup = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
    try {
      await cleanup.sector.update({ where: { id: sectorId }, data: { distributionMode: "NONE", maxActivePerAttendant: null, lastDistributedToId: null } });
      await cleanup.attendantAbsence.deleteMany({ where: { user: { email: `${unique}@example.test` } } });
      await cleanup.user.updateMany({ where: { email: `${unique}@example.test` }, data: { isActive: false } });
    } finally {
      await cleanup.$disconnect();
    }
  }
});
