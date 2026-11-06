import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "../../scripts/demo-data";
import { ENTRANCE } from "./entrance";

// SPEC 2026-11-06-escalonamento, section 7 (SF-155): the administrator turns the setting on, an
// overdue request is processed by the daily job route (as Vercel Cron calls it), and the manager
// gets the notification and sees the escalation on the request.

async function enterAs(page: Page, profile: "Administrador" | "Gestor") {
  await page.goto("/");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration
  await page.getByRole("button", { name: `Entrar como ${profile}` }).click();
  await expect(page).not.toHaveURL(ENTRANCE);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(ENTRANCE);
}

test("an overdue request of a sector with escalation is raised and the manager is warned", async ({ page, playwright }) => {
  test.setTimeout(180_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  let requestId: string;
  try {
    await seedDemoData(database);
    await database.sector.updateMany({ data: { escalateOverdue: false } });
    // An open request of the manager's sector, made overdue with a NORMAL priority. It needs an
    // approval-free service, so the manager reads it with "Ver todas as solicitações do setor".
    const request = await database.request.findFirstOrThrow({ where: { status: "OPEN", approvalState: null, sector: { name: "Central de Serviços" } } });
    await database.requestEscalation.deleteMany({ where: { requestId: request.id } });
    await database.request.update({
      where: { id: request.id },
      data: { priority: "NORMAL", slaHoursSnapshot: 8, dueAt: new Date(Date.now() - 60 * 60 * 1000), slaWarningNotifiedAt: null, slaBreachNotifiedAt: null, slaPausedAt: null },
    });
    requestId = request.id;
    const manager = await database.user.findFirstOrThrow({ where: { role: "MANAGER", sector: { name: "Central de Serviços" } } });
    const admin = await database.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    await database.userPermission.upsert({
      where: { userId_permission: { userId: manager.id, permission: "SECTOR_REQUESTS_READ" } },
      create: { userId: manager.id, permission: "SECTOR_REQUESTS_READ", grantedById: admin.id, grantedAt: new Date() },
      update: {},
    });
  } finally {
    await database.$disconnect();
  }

  // The administrator turns the setting on for the sector.
  await enterAs(page, "Administrador");
  await page.goto("/admin?section=sectors");
  await page.getByRole("button", { name: "Ligar escalonamento de Central de Serviços" }).click();
  await expect(page.getByRole("button", { name: "Desligar escalonamento de Central de Serviços" })).toBeVisible();
  await signOut(page);

  // The daily job runs as Vercel Cron calls it.
  const api = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3100" });
  const refused = await api.get("/api/cron/daily");
  expect(refused.status()).toBe(401);
  const run = await api.get("/api/cron/daily", { headers: { authorization: `Bearer ${process.env.E2E_CRON_SECRET}` } });
  expect(run.status()).toBe(200);
  await api.dispose();

  // The manager is warned and sees the escalation on the request.
  await enterAs(page, "Gestor");
  await page.goto("/approvals/notifications");
  await expect(page.getByText(/Solicitação vencida escalada/).first()).toBeVisible();
  await page.goto(`/approvals/${requestId!}`);
  const block = page.getByRole("region", { name: "Escalonamentos" });
  await expect(block).toContainText("prioridade Normal → Alta");

  // Later tests of the run start from the default (off).
  const cleanup = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  try {
    await cleanup.sector.updateMany({ data: { escalateOverdue: false } });
  } finally {
    await cleanup.$disconnect();
  }
});
