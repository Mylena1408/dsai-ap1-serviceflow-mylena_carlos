import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { ENTRANCE } from "./entrance";
import { seedDemoData } from "../../scripts/demo-data";

// SPEC 2026-11-07-operacao-e-automacao, section 8, part C (SF-186; CA-REC-02 to 05 through the screens):
// the manager creates a schedule for a service of the sector, the protected daily job route opens the
// request in the requester's name, the requester sees where it came from, the manager sees the run and
// pauses and ends the schedule; the audit trail records it.

const unique = `e2e-agenda-${Date.now()}`;
const serviceName = `${unique} Limpeza`;
const scheduleName = `${unique} Agenda`;

async function enterAs(page: Page, profile: "Administrador" | "Solicitante" | "Gestor") {
  await page.goto("/");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration
  await page.getByRole("button", { name: `Entrar como ${profile}` }).click();
  await expect(page).not.toHaveURL(ENTRANCE);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(ENTRANCE);
}

// Even when the test stops halfway, later tests that call the daily job find no active schedule.
test.afterEach(async () => {
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  try {
    await database.recurringRequest.updateMany({ where: { endedAt: null }, data: { endedAt: new Date() } });
  } finally {
    await database.$disconnect();
  }
});

test("a schedule opens its request through the daily job and is paused and ended", async ({ page, playwright }) => {
  test.setTimeout(240_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  let fieldId = "";
  let serviceId = "";
  try {
    await seedDemoData(database);
    const sector = await database.sector.findFirstOrThrow({ where: { name: "Central de Serviços" } });
    await database.sector.update({ where: { id: sector.id }, data: { distributionMode: "NONE" } });
    const category = await database.category.findFirstOrThrow({ where: { isActive: true } });
    // A service of the manager's sector with one field and no documents or approval.
    const service = await database.service.create({
      data: { name: serviceName, description: "Serviço do teste.", categoryId: category.id, sectorId: sector.id },
    });
    serviceId = service.id;
    fieldId = (
      await database.serviceField.create({ data: { serviceId: service.id, label: "Sala", type: "SHORT_TEXT", isRequired: true, options: [], position: 1 } })
    ).id;
  } finally {
    await database.$disconnect();
  }

  // The manager creates the schedule, every day from today (CA-REC-02).
  await enterAs(page, "Gestor");
  await page.getByRole("link", { name: "Agendas" }).click();
  await expect(page.getByRole("heading", { name: "Agendas", level: 1 })).toBeVisible();
  const choice = page.getByRole("form", { name: "Escolher o serviço da nova agenda" }).locator('select[name="service"]');
  await expect(choice.locator(`option[value="${serviceId}"]`)).toHaveText(`${serviceName} (Central de Serviços)`);
  await choice.selectOption(serviceId);
  await page.getByRole("button", { name: "Continuar" }).click();
  const form = page.getByRole("form", { name: "Nova agenda" });
  await form.locator('[name="name"]').fill(scheduleName);
  await form.locator('[name="requesterId"]').selectOption({ label: "Ana Souza" });
  await form.locator('[name="description"]').fill("Limpeza preventiva dos filtros do ar.");
  await form.locator(`[name="field.${fieldId}"]`).fill("Sala 12");
  for (const weekday of ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"]) {
    await form.getByLabel(weekday, { exact: true }).check();
  }
  // The organization's today, as the form offers it.
  const startsOn = await form.locator('[name="startsOn"]').getAttribute("min");
  expect(startsOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await form.locator('[name="startsOn"]').fill(startsOn!);
  await form.getByRole("button", { name: "Criar agenda" }).click();
  await expect(page.locator("p.feedback")).toHaveText("Agenda criada.");
  const row = page.getByRole("row", { name: new RegExp(scheduleName) });
  await expect(row).toContainText("Diária");
  await expect(row).toContainText("Ativa");
  await expect(row).toContainText("Nenhuma ainda");
  await signOut(page);

  // The daily job runs as Vercel Cron calls it (CA-REC-03).
  const api = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3100" });
  const run = await api.get("/api/cron/daily", { headers: { authorization: `Bearer ${process.env.E2E_CRON_SECRET}` } });
  expect(run.status()).toBe(200);
  expect((await run.json()).recurringRequests).toEqual({ status: "ok", result: { opened: 1, skipped: 0, paused: 0, failed: 0 } });
  // A second call on the same day opens nothing more.
  const again = await api.get("/api/cron/daily", { headers: { authorization: `Bearer ${process.env.E2E_CRON_SECRET}` } });
  expect((await again.json()).recurringRequests).toMatchObject({ result: { opened: 0 } });
  await api.dispose();

  // The requester sees the request and the schedule that opened it (5.3 item 4).
  const reader = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  let requestId = "";
  try {
    requestId = (await reader.request.findFirstOrThrow({ where: { recurringRequest: { name: scheduleName } } })).id;
  } finally {
    await reader.$disconnect();
  }
  await enterAs(page, "Solicitante");
  await page.goto(`/requests/${requestId}`);
  await expect(page.getByRole("heading", { name: serviceName })).toBeVisible();
  await expect(page.getByText(`Aberta automaticamente pela agenda “${scheduleName}”.`)).toBeVisible();
  await expect(page.locator(".request-description")).toHaveText("Limpeza preventiva dos filtros do ar.");
  await signOut(page);

  // The manager sees the run, pauses and ends the schedule (CA-REC-05).
  await enterAs(page, "Gestor");
  await page.goto("/approvals/recurring");
  const [year, month, date] = startsOn!.split("-");
  await expect(row).toContainText(`${date}/${month}/${year}: aberta`);
  await row.getByRole("button", { name: "Pausar" }).click();
  await expect(page.locator("p.feedback")).toHaveText("Agenda pausada.");
  await expect(row).toContainText("Pausada");
  await row.getByRole("button", { name: "Encerrar" }).click();
  await expect(page.locator("p.feedback")).toHaveText("Agenda encerrada.");
  await expect(row).toContainText("Encerrada");
  await expect(row.getByRole("button")).toHaveCount(0);
  await signOut(page);

  // The audit trail records the schedule (CA-REC-02).
  await enterAs(page, "Administrador");
  await page.goto("/admin?section=audit&type=RECURRING_REQUEST");
  await expect(page.getByRole("region", { name: "Auditoria" })).toContainText(`Criou · Agenda de recorrência · ${scheduleName}`);
});
