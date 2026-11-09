import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { ENTRANCE } from "./entrance";
import { seedDemoData } from "../../scripts/demo-data";
import { DEMO_ACCOUNTS } from "../../src/modules/auth/domain/demo-accounts";

// SPEC 2026-11-08-atendimento-dia-a-dia, section 11, part F (SF-219; CA-DUP-01 to 03 through the screens): the attendant
// closes a request linked as a duplicate; both histories show it; the original offers no such closing; the duplicate's
// requester reaches the original as someone who follows it.

const unique = `e2e-dup-${Date.now()}`;
const serviceName = `${unique} Serviço`;
const repeatedName = `${unique} Repetido`;
const code = (id: string) => id.slice(0, 8).toUpperCase();

async function enterAs(page: Page, profile: "Atendente" | "Solicitante") {
  await page.goto("/");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration
  await page.getByRole("button", { name: `Entrar como ${profile}` }).click();
  await expect(page).not.toHaveURL(ENTRANCE);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(ENTRANCE);
}

// Later tests of the run meet neither the service, nor open requests of the demo requester, nor the original she
// started following (followers.spec.ts expects her to follow nothing at the end).
test.afterEach(async () => {
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  try {
    await database.requestFollower.deleteMany({ where: { request: { serviceNameSnapshot: { startsWith: unique } } } });
    await database.service.updateMany({ where: { name: { startsWith: unique } }, data: { isActive: false } });
    await database.request.updateMany({
      where: { serviceNameSnapshot: { startsWith: unique }, status: { not: "CANCELLED" } },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
  } finally {
    await database.$disconnect();
  }
});

test("close as duplicate: both histories, no closing on the original, the requester follows the original", async ({ page }) => {
  test.setTimeout(240_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  let originalId = "";
  let duplicateId = "";
  try {
    await seedDemoData(database);
    const sector = await database.sector.findFirstOrThrow({ where: { name: "Central de Serviços" } });
    const category = await database.category.findFirstOrThrow({ where: { isActive: true } });
    const service = await database.service.create({ data: { name: serviceName, description: "Serviço do teste.", categoryId: category.id, sectorId: sector.id } });
    const ana = await database.user.findUniqueOrThrow({ where: { email: DEMO_ACCOUNTS.REQUESTER.email } });
    const attendant = await database.user.findUniqueOrThrow({ where: { email: DEMO_ACCOUNTS.ATTENDANT.email } });
    const other = await database.user.create({
      data: { name: `Rita ${unique.slice(-6)}`, email: `${unique}@exemplo.test`, role: "REQUESTER", passwordHash: ana.passwordHash },
    });
    const open = (requesterId: string, description: string) =>
      database.request.create({
        data: {
          requesterId,
          serviceId: service.id,
          sectorId: sector.id,
          serviceNameSnapshot: service.name,
          serviceDescriptionSnapshot: service.description,
          categoryIdSnapshot: category.id,
          categoryNameSnapshot: category.name,
          sectorNameSnapshot: sector.name,
          description,
          status: "OPEN",
        },
      });
    originalId = (await open(other.id, "Pedido original.")).id;
    duplicateId = (await open(ana.id, "O mesmo pedido, de novo.")).id;
    // Linked as "duplicada de", as the links form would (SPEC 2026-11-07-operacao-e-automacao, 3.3 item 1).
    await database.requestLink.create({
      data: { fromRequestId: duplicateId, toRequestId: originalId, kind: "DUPLICATE_OF", createdById: attendant.id, createdAt: new Date() },
    });
  } finally {
    await database.$disconnect();
  }

  await enterAs(page, "Atendente");
  // The original offers no closing as a duplicate (CA-DUP-01).
  await page.goto(`/queue/${originalId}`);
  await expect(page.getByRole("heading", { level: 1, name: serviceName })).toBeVisible();
  await expect(page.getByText("Cancelar solicitação")).toBeVisible();
  await expect(page.getByText("Encerrar como duplicada")).toHaveCount(0);

  // The duplicate: refused without the note by the browser, closed with it.
  await page.goto(`/queue/${duplicateId}`);
  await page.getByText("Encerrar como duplicada", { exact: true }).click();
  const form = page.locator("details", { hasText: "Encerrar como duplicada" });
  await expect(form).toContainText(`Duplicada de #${code(originalId)}`);
  await form.getByLabel("Nota (obrigatória)").fill("Mesmo pedido da colega.");
  await form.getByRole("button", { name: "Confirmar encerramento como duplicada" }).click();
  await expect(page.getByRole("status")).toContainText("Solicitação encerrada como duplicada.");
  await expect(page.getByText(`Encerrada como duplicada de #${code(originalId)}`)).toBeVisible();
  await expect(page.getByText(`Duplicada de #${code(originalId)}. Mesmo pedido da colega.`)).toBeVisible();
  await expect(page.getByText("Encerrar como duplicada", { exact: true })).toHaveCount(0);

  // The original's history tells the other side.
  await page.goto(`/queue/${originalId}`);
  await expect(page.getByText(`Duplicada #${code(duplicateId)} encerrada`)).toBeVisible();
  await signOut(page);

  // The duplicate's requester goes from the closed request to the original, as someone who follows it (CA-DUP-03).
  await enterAs(page, "Solicitante");
  await page.goto(`/requests/${duplicateId}`);
  const note = page.getByRole("note").filter({ hasText: "Esta solicitação foi encerrada como duplicada." });
  await note.getByRole("link", { name: serviceName }).click();
  await expect(page).toHaveURL(new RegExp(`/requests/following/${originalId}`));
  await expect(page.getByRole("heading", { level: 1, name: serviceName })).toBeVisible();
  await expect(page.getByText("Pedido original.")).toBeVisible();
});

test("possible duplicates: the same requester's request of the same service, linked by the shortcut, then closed", async ({ page }) => {
  test.setTimeout(240_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  let olderId = "";
  let newerId = "";
  try {
    await seedDemoData(database);
    const sector = await database.sector.findFirstOrThrow({ where: { name: "Central de Serviços" } });
    const category = await database.category.findFirstOrThrow({ where: { isActive: true } });
    const service = await database.service.create({
      data: { name: repeatedName, description: "Serviço do teste.", categoryId: category.id, sectorId: sector.id },
    });
    const ana = await database.user.findUniqueOrThrow({ where: { email: DEMO_ACCOUNTS.REQUESTER.email } });
    const open = (description: string, createdAt: Date) =>
      database.request.create({
        data: {
          requesterId: ana.id,
          serviceId: service.id,
          sectorId: sector.id,
          serviceNameSnapshot: service.name,
          serviceDescriptionSnapshot: service.description,
          categoryIdSnapshot: category.id,
          categoryNameSnapshot: category.name,
          sectorNameSnapshot: sector.name,
          description,
          status: "OPEN",
          createdAt,
        },
      });
    olderId = (await open("Primeiro pedido.", new Date(Date.now() - 2 * 24 * 60 * 60 * 1000))).id;
    newerId = (await open("Pedido repetido.", new Date())).id;
  } finally {
    await database.$disconnect();
  }

  await enterAs(page, "Atendente");
  await page.goto(`/queue/${newerId}`);
  const suggestions = page.getByRole("list", { name: "Possíveis duplicadas" });
  await expect(suggestions).toContainText(`#${code(olderId)}`);
  await suggestions.getByRole("button", { name: `Vincular esta como duplicada de #${code(olderId)}` }).click();
  await expect(page.getByRole("status")).toContainText("Solicitação vinculada.");
  // Linked now: no longer a suggestion, and the closing is offered.
  await expect(page.getByRole("list", { name: "Possíveis duplicadas" })).toHaveCount(0);
  await page.getByText("Encerrar como duplicada", { exact: true }).click();
  const form = page.locator("details", { hasText: "Encerrar como duplicada" });
  await form.getByLabel("Nota (obrigatória)").fill("Pedido repetido pela mesma pessoa.");
  await form.getByRole("button", { name: "Confirmar encerramento como duplicada" }).click();
  await expect(page.getByRole("status")).toContainText("Solicitação encerrada como duplicada.");
  await expect(page.getByText(`Encerrada como duplicada de #${code(olderId)}`)).toBeVisible();
});

test("batch: two requests closed as duplicates of the same original, item by item", async ({ page }) => {
  test.setTimeout(240_000);
  const batchName = `${unique} Lote`;
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  let originalId = "";
  const duplicateIds: string[] = [];
  try {
    await seedDemoData(database);
    const sector = await database.sector.findFirstOrThrow({ where: { name: "Central de Serviços" } });
    const category = await database.category.findFirstOrThrow({ where: { isActive: true } });
    const service = await database.service.create({ data: { name: batchName, description: "Serviço do teste.", categoryId: category.id, sectorId: sector.id } });
    const ana = await database.user.findUniqueOrThrow({ where: { email: DEMO_ACCOUNTS.REQUESTER.email } });
    const open = (description: string) =>
      database.request.create({
        data: {
          requesterId: ana.id,
          serviceId: service.id,
          sectorId: sector.id,
          serviceNameSnapshot: service.name,
          serviceDescriptionSnapshot: service.description,
          categoryIdSnapshot: category.id,
          categoryNameSnapshot: category.name,
          sectorNameSnapshot: sector.name,
          description,
          status: "OPEN",
        },
      });
    originalId = (await open("O pedido que fica.")).id;
    for (const description of ["Repetido 1.", "Repetido 2."]) duplicateIds.push((await open(description)).id);
  } finally {
    await database.$disconnect();
  }
  const label = (id: string) => `${batchName} (#${id.slice(0, 8)})`;

  await enterAs(page, "Atendente");
  await page.goto(`/queue?q=${encodeURIComponent(batchName)}`);
  const batch = page.getByRole("region", { name: "Ações em lote" });
  for (const id of duplicateIds) await page.getByRole("checkbox", { name: `Marcar ${label(id)} para ação em lote` }).check();
  await batch.locator('select[name="action"]').selectOption("duplicate");
  await batch.getByLabel("Código da original").fill(`#${code(originalId)}`);
  await batch.getByLabel("Nota do encerramento").fill("Repetidos do mesmo pedido.");
  await batch.getByRole("button", { name: "Aplicar às marcadas" }).click();

  await expect(batch.getByRole("status")).toContainText("Encerrar como duplicada de: 2 feitas, 0 recusadas.");
  const items = batch.getByRole("list", { name: "Resultado por solicitação" });
  for (const id of duplicateIds) await expect(items).toContainText(`${label(id)}: feito`);

  // Each one carries the closing in its history; the original lists both.
  await page.goto(`/queue/${duplicateIds[0]}`);
  await expect(page.getByText(`Encerrada como duplicada de #${code(originalId)}`)).toBeVisible();
  await page.goto(`/queue/${originalId}`);
  for (const id of duplicateIds) await expect(page.getByText(`Duplicada #${code(id)} encerrada`)).toBeVisible();
});
