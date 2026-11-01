import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "../../scripts/demo-data";

// SPEC 2026-10-31-eventos-outbox-jobs, section 12 (SF-064): an attendant comments, the
// requester sees the counter right away (no cron), opens the request from the notification
// and the counter clears.

const unique = `e2e-notif-${Date.now()}`;

async function enterAs(page: Page, profile: "Solicitante" | "Atendente") {
  await page.goto("/login");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration
  await page.getByRole("button", { name: `Entrar como ${profile}` }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login/);
}

const notificationsLink = (page: Page) =>
  page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: /^Notificações/ });

async function clearNotifications(page: Page, path: string) {
  await page.goto(path);
  const markAll = page.getByRole("button", { name: "Marcar todas como lidas" });
  if (await markAll.count()) {
    await markAll.click();
    await expect(page.getByRole("button", { name: "Marcar todas como lidas" })).toHaveCount(0);
  }
  await expect(notificationsLink(page)).toHaveAccessibleName("Notificações");
}

test("a comment notifies the requester right away and opening it clears the counter", async ({ page }) => {
  test.setTimeout(180_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  try {
    await seedDemoData(database);
  } finally {
    await database.$disconnect();
  }

  // Requester starts with no unread notifications and opens a request.
  await enterAs(page, "Solicitante");
  await clearNotifications(page, "/notifications");
  await page.goto("/catalog");
  await page.getByRole("link", { name: "Reparo de mobiliário" }).first().click();
  await page.getByLabel("Descreva o que você precisa").fill(`${unique} gaveta emperrada`);
  await page.getByRole("button", { name: "Enviar solicitação" }).click();
  await expect(page.getByRole("status")).toHaveText("Sua solicitação foi aberta.");
  const requestId = new URL(page.url()).pathname.split("/").at(-1)!;
  // A comment of the requester without an assignee notifies nobody on the team (E4).
  await page.getByLabel("Novo comentário").fill("Alguém pode olhar?");
  await page.getByRole("button", { name: "Enviar comentário" }).click();
  await expect(page.locator("p.feedback")).toHaveText("Comentário enviado.");
  await signOut(page);

  // Attendant has nothing new about it, then answers.
  await enterAs(page, "Atendente");
  await clearNotifications(page, "/queue/notifications");
  await page.goto(`/queue/${requestId}`);
  await page.getByLabel("Novo comentário").fill("Vamos verificar amanhã.");
  await page.getByRole("button", { name: "Enviar comentário" }).click();
  await expect(page.locator("p.feedback")).toHaveText("Comentário enviado.");
  await page.getByLabel("Novo comentário").fill("Só para a equipe.");
  await page.getByLabel("Nota interna (o solicitante não vê)").check();
  await page.getByRole("button", { name: "Enviar comentário" }).click();
  await expect(page.locator("p.feedback")).toHaveText("Comentário enviado.");
  await expect(notificationsLink(page)).toHaveAccessibleName("Notificações");
  await signOut(page);

  // Requester sees exactly one new notification, processed right after the action (CA-EVT-08).
  await enterAs(page, "Solicitante");
  await expect(async () => {
    await page.goto("/notifications");
    await expect(notificationsLink(page)).toHaveAccessibleName("Notificações, 1 não lidas");
  }).toPass({ timeout: 15_000 });
  const item = page.locator("ul.notification-list > li").first();
  await expect(item).toContainText("Novo comentário em Reparo de mobiliário");
  await expect(item).toContainText("Não lida");
  await expect(page.getByText("Nova nota interna")).toHaveCount(0);

  // Opening it leads to the request and marks it as read (CA-EVT-07).
  await item.getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/requests/${requestId}$`));
  await expect(page.getByText("Vamos verificar amanhã.")).toBeVisible();
  await expect(notificationsLink(page)).toHaveAccessibleName("Notificações");
  await page.goto("/notifications");
  await expect(page.locator("ul.notification-list > li").first()).toContainText("Lida");
});
