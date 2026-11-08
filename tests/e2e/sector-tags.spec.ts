import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { ENTRANCE } from "./entrance";
import { seedDemoData } from "../../scripts/demo-data";

// SPEC 2026-11-08-atendimento-dia-a-dia, section 11, part A (SF-199; CA-ETQ-01 to 04 through the screens): the
// manager creates a tag; the attendant puts it on a request, finds it by the tag in the queue and takes it off
// in a batch; "Análises" counts it; the requester never sees it.

const unique = `e2e-etq-${Date.now()}`;
const tagName = `${unique.slice(-8)} Rede`;
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

// Later tests of the run do not see the tag among the sector's choices.
test.afterEach(async () => {
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  try {
    await database.sectorTag.updateMany({ where: { name: tagName }, data: { isActive: false } });
  } finally {
    await database.$disconnect();
  }
});

test("tags: created by the manager, put on and found by the attendant, counted, hidden from the requester", async ({ page }) => {
  test.setTimeout(240_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  let requestId = "";
  try {
    await seedDemoData(database);
    const sector = await database.sector.findFirstOrThrow({ where: { name: "Central de Serviços" } });
    const category = await database.category.findFirstOrThrow({ where: { isActive: true } });
    const service = await database.service.create({ data: { name: serviceName, description: "Serviço do teste.", categoryId: category.id, sectorId: sector.id } });
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
        description: "Pedido para etiquetar.",
        status: "OPEN",
      },
    });
    requestId = request.id;
  } finally {
    await database.$disconnect();
  }

  // The manager creates the sector's tag (CA-ETQ-02).
  await enterAs(page, "Gestor");
  await page.getByRole("link", { name: "Etiquetas" }).click();
  const create = page.getByRole("form", { name: "Nova etiqueta de Central de Serviços" });
  await create.locator('[name="name"]').fill(tagName);
  await create.locator('select[name="color"]').selectOption("teal");
  await create.getByRole("button", { name: "Criar etiqueta" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Etiqueta criada." })).toBeVisible();
  await expect(page.getByRole("table", { name: "Etiquetas de Central de Serviços" })).toContainText(tagName);
  await signOut(page);

  // The attendant puts it on the request (CA-ETQ-03).
  await enterAs(page, "Atendente");
  await page.goto(`/queue/${requestId}`);
  const tags = page.getByRole("region", { name: "Etiquetas" });
  await tags.locator('select[name="tagId"]').selectOption({ label: tagName });
  await tags.getByRole("button", { name: "Aplicar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Etiqueta aplicada." })).toBeVisible();
  await expect(page.getByRole("list", { name: "Etiquetas da solicitação" })).toContainText(tagName);
  await expect(page.locator("ol.history-list")).toContainText(`Etiqueta "${tagName}" aplicada`);

  // The queue shows it and finds the request by it (CA-ETQ-04).
  await page.goto(`/queue?q=${encodeURIComponent(unique)}`);
  await expect(page.locator(".content-list")).toContainText(tagName);
  await page.getByRole("checkbox", { name: tagName }).check();
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page).toHaveURL(/tag=/);
  await expect(page.locator(".content-list")).toContainText(serviceName);

  // A batch takes it off.
  await page.getByRole("checkbox", { name: new RegExp(`^Marcar ${serviceName}`) }).check();
  const batch = page.getByRole("region", { name: "Ações em lote" });
  await batch.locator('select[name="action"]').selectOption("untag");
  await batch.locator('select[name="tagId"]').selectOption({ label: tagName });
  await batch.getByRole("button", { name: "Aplicar às marcadas" }).click();
  await expect(batch.getByRole("status")).toContainText("Retirar etiqueta: 1 feita, 0 recusadas.");
  await page.goto(`/queue/${requestId}`);
  await expect(page.locator("ol.history-list")).toContainText(`Etiqueta "${tagName}" retirada`);
  // Put back on, so "Análises" counts it.
  await page.getByRole("region", { name: "Etiquetas" }).locator('select[name="tagId"]').selectOption({ label: tagName });
  await page.getByRole("region", { name: "Etiquetas" }).getByRole("button", { name: "Aplicar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Etiqueta aplicada." })).toBeVisible();
  await signOut(page);

  // The manager sees it in "Análises" (CA-ETQ-04).
  await enterAs(page, "Gestor");
  await page.goto("/approvals/analytics");
  await expect(page.getByRole("heading", { name: "Etiquetas", level: 2 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Solicitações por etiqueta" })).toContainText(tagName);
  await signOut(page);

  // The requester never sees tags (decision I2).
  await enterAs(page, "Solicitante");
  await page.goto(`/requests/${requestId}`);
  await expect(page.getByText("Pedido para etiquetar.")).toBeVisible();
  await expect(page.getByText(tagName)).toHaveCount(0);
});
