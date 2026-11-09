import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { ENTRANCE } from "./entrance";
import { seedDemoData } from "../../scripts/demo-data";

// SPEC 2026-11-08-atendimento-dia-a-dia, section 11, part B (SF-205; CA-CHK-01 to 04 through the screens): the
// manager builds a service's checklist; the attendant starts a request, which receives the copy; the completion
// is refused with the item still to mark; the attendant marks it with a note and completes; the history shows
// the marking; the requester never sees the checklist.

const unique = `e2e-chk-${Date.now()}`;
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

test("checklist: built by the manager, copied on start, required at completion, marked with a note", async ({ page }) => {
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
        description: "Pedido com checklist.",
        status: "OPEN",
      },
    });
    requestId = request.id;
  } finally {
    await database.$disconnect();
  }

  // The manager builds the service's checklist (CA-CHK-02).
  await enterAs(page, "Gestor");
  await page.getByRole("link", { name: "Checklists" }).click();
  await page.locator("summary").filter({ hasText: serviceName }).click();
  for (const [text, kind] of [
    ["Conferir a licença", "true"],
    ["Avisar o solicitante", "false"],
  ]) {
    const form = page.getByRole("form", { name: `Novo item do checklist de ${serviceName}` });
    await form.locator('[name="text"]').fill(text);
    await form.locator('select[name="isRequired"]').selectOption(kind);
    await form.getByRole("button", { name: "Acrescentar item" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Item acrescentado ao checklist." })).toBeVisible();
  }
  await expect(page.getByRole("table", { name: `Checklist de ${serviceName}` })).toContainText("Conferir a licença");
  await signOut(page);

  // The attendant starts it: the copy arrives (CA-CHK-03).
  await enterAs(page, "Atendente");
  await page.goto(`/queue/${requestId}`);
  await expect(page.getByRole("region", { name: "Checklist" })).toHaveCount(0);
  await page.getByRole("button", { name: "Iniciar atendimento" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Atendimento iniciado." })).toBeVisible();
  const checklist = page.getByRole("region", { name: "Checklist" });
  await expect(checklist).toContainText("Checklist 0/2");
  await expect(checklist).toContainText("Obrigatórios por marcar: Conferir a licença.");

  // The completion is refused with what is missing (CA-CHK-04).
  await page.getByRole("button", { name: "Concluir solicitação" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "há itens obrigatórios do checklist por marcar" })).toContainText(
    'Falta marcar: "Conferir a licença".',
  );

  // Marked with a note, the completion goes on; the optional item may stay unmarked.
  const mark = checklist.getByRole("form", { name: "Marcar Conferir a licença" });
  await mark.locator('[name="note"]').fill("Licença 2026 ativa");
  await mark.getByRole("button", { name: "Marcar como concluído" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Item do checklist marcado." })).toBeVisible();
  await expect(checklist).toContainText("Checklist 1/2");
  await expect(checklist).toContainText("Observação: Licença 2026 ativa");
  await expect(page.locator("ol.history-list")).toContainText('Item do checklist "Conferir a licença" concluído');
  // The queue's list shows the progress (13.1 item 3).
  await page.goto(`/queue?q=${encodeURIComponent(unique)}`);
  await expect(page.locator(".content-list")).toContainText("Checklist 1/2");
  await page.goto(`/queue/${requestId}`);
  await page.getByRole("button", { name: "Concluir solicitação" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Solicitação concluída." })).toBeVisible();
  // A completed request's checklist only shows.
  await expect(page.getByRole("region", { name: "Checklist" }).locator("form")).toHaveCount(0);
  await signOut(page);

  // The requester never sees the checklist (decision I6).
  await enterAs(page, "Solicitante");
  await page.goto(`/requests/${requestId}`);
  await expect(page.getByText("Pedido com checklist.")).toBeVisible();
  await expect(page.getByText("Conferir a licença")).toHaveCount(0);
});
