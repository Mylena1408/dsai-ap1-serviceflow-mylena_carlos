import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { ENTRANCE } from "./entrance";
import { seedDemoData } from "../../scripts/demo-data";

// SPEC 2026-11-08-atendimento-dia-a-dia, section 11, part C (SF-210; CA-HRS-01 to 03 through the screens): the
// attendant logs time with a note, changes it and logs more; the detail shows the total against the estimate and
// the history; the manager's report and CSV count it; the requester never sees it.

const unique = `e2e-hrs-${Date.now()}`;
const serviceName = `${unique} Serviço`;

async function enterAs(page: Page, profile: "Gestor" | "Atendente" | "Solicitante") {
  await page.goto("/");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration
  await page.getByRole("button", { name: `Entrar como ${profile}` }).click();
  await expect(page).not.toHaveURL(ENTRANCE);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(ENTRANCE);
}

// Later tests of the run do not meet the service among the sector's active ones.
test.afterEach(async () => {
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  try {
    await database.service.updateMany({ where: { name: serviceName }, data: { isActive: false } });
  } finally {
    await database.$disconnect();
  }
});

test("time: logged and changed by the attendant, totalled against the estimate, reported to the manager", async ({ page }) => {
  test.setTimeout(240_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  let requestId = "";
  try {
    await seedDemoData(database);
    const sector = await database.sector.findFirstOrThrow({ where: { name: "Central de Serviços" } });
    const category = await database.category.findFirstOrThrow({ where: { isActive: true } });
    const service = await database.service.create({
      data: { name: serviceName, description: "Serviço do teste.", categoryId: category.id, sectorId: sector.id, estimatedHours: 4 },
    });
    const requester = await database.user.findUniqueOrThrow({ where: { email: "ana.souza@exemplo.test" } });
    const request = await database.request.create({
      data: {
        requesterId: requester.id,
        serviceId: service.id,
        sectorId: sector.id,
        serviceNameSnapshot: service.name,
        serviceDescriptionSnapshot: service.description,
        categoryIdSnapshot: category.id,
        categoryNameSnapshot: category.name,
        sectorNameSnapshot: sector.name,
        description: "Pedido com horas.",
        status: "OPEN",
      },
    });
    requestId = request.id;
  } finally {
    await database.$disconnect();
  }

  // The attendant logs time with a note and changes it (CA-HRS-02).
  await enterAs(page, "Atendente");
  await page.goto(`/queue/${requestId}`);
  const time = page.getByRole("region", { name: "Horas" });
  await expect(time).toContainText("Nenhuma hora lançada.");
  const log = time.getByRole("form", { name: "Lançar horas" });
  await log.locator('[name="hours"]').fill("1");
  await log.locator('[name="minutes"]').fill("30");
  await log.locator('[name="note"]').fill("Instalação no local");
  await log.getByRole("button", { name: "Lançar horas" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Horas lançadas." })).toBeVisible();
  await expect(time).toContainText("Total: 1h 30min de 4h estimadas");
  await expect(time).toContainText("Instalação no local");

  await time.locator("summary").filter({ hasText: "Alterar" }).first().click();
  const change = time.getByRole("form", { name: /^Alterar o lançamento de / });
  await change.locator('[name="hours"]').fill("2");
  await change.locator('[name="minutes"]').fill("0");
  await change.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Lançamento alterado." })).toBeVisible();
  await expect(time).toContainText("Total: 2h de 4h estimadas");
  await expect(page.locator("ol.history-list")).toContainText("Horas lançadas: 1h 30min");
  await expect(page.locator("ol.history-list")).toContainText("Horas alteradas: 2h");

  // An invalid duration is refused with its message.
  await log.locator('[name="hours"]').fill("0");
  await log.locator('[name="minutes"]').fill("0");
  await log.getByRole("button", { name: "Lançar horas" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Informe de 1 minuto a 12 horas" })).toBeVisible();

  // "Minhas horas" in "Meu painel" (13.2 item 2).
  await page.goto("/queue/dashboard");
  const mine = page.getByRole("region", { name: "Minhas horas" });
  await expect(mine.getByRole("table", { name: "Minhas horas por serviço" })).toContainText(serviceName);
  await signOut(page);

  // The manager's report and CSV count it (CA-HRS-03).
  await enterAs(page, "Gestor");
  await page.getByRole("link", { name: "Horas" }).click();
  await expect(page.getByRole("heading", { name: "Horas do setor" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Horas por serviço" })).toContainText(serviceName);
  const csv = await page.request.get("/api/reports/hours.csv?period=7");
  expect(csv.status()).toBe(200);
  const content = await csv.text();
  expect(content).toContain(serviceName);
  expect(content).toContain(`;${requestId.slice(0, 8).toUpperCase()};120;2,00`);
  expect(content).not.toContain("Instalação no local");
  await signOut(page);

  // The requester never sees the time (decision I9).
  await enterAs(page, "Solicitante");
  await page.goto(`/requests/${requestId}`);
  await expect(page.getByText("Pedido com horas.")).toBeVisible();
  await expect(page.getByText("Instalação no local")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Horas" })).toHaveCount(0);
});
