import { expect, test, type Page } from "@playwright/test";
import { ENTRANCE } from "./entrance";
import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "../../scripts/demo-data";

// SPEC 2026-11-01-notificacoes-email-preferencias, section 8 (SF-096): the requester turns on
// "Mudanças de status", the attendant starts the request and the administrator sees the delivery
// in "E-mails" as not sent, because the test environment has no email provider.

const unique = `e2e-email-${Date.now()}`;

async function enterAs(page: Page, profile: "Administrador" | "Solicitante" | "Atendente") {
  await page.goto("/");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration
  await page.getByRole("button", { name: `Entrar como ${profile}` }).click();
  await expect(page).not.toHaveURL(ENTRANCE);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(ENTRANCE);
}

async function setStatusEmails(page: Page, on: boolean) {
  await page.goto("/notifications");
  await page.getByRole("link", { name: "Preferências de e-mail" }).click();
  await expect(page).toHaveURL(/\/notifications\/preferences/);
  await page.getByLabel("Mudanças de status").setChecked(on);
  await page.getByRole("button", { name: "Salvar preferências" }).click();
  await expect(page.getByRole("status")).toHaveText("Preferências salvas.");
  await expect(page.getByLabel("Mudanças de status")).toBeChecked({ checked: on });
}

test("a status change the requester chose to receive is registered as an email for the administrator", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  try {
    await seedDemoData(database);
  } finally {
    await database.$disconnect();
  }

  // The requester turns on status emails (everything else stays off) and opens a request.
  await enterAs(page, "Solicitante");
  await setStatusEmails(page, true);
  await expect(page.getByLabel("Comentários e notas internas")).not.toBeChecked();
  await page.goto("/catalog");
  await page.getByRole("link", { name: "Reparo de mobiliário" }).first().click();
  await page.getByLabel("Descreva o que você precisa").fill(`${unique} cadeira quebrada`);
  await page.getByRole("button", { name: "Enviar solicitação" }).click();
  await expect(page.getByRole("status")).toHaveText("Sua solicitação foi aberta.");
  const requestId = new URL(page.url()).pathname.split("/").at(-1)!;
  await signOut(page);

  // The attendant starts it.
  await enterAs(page, "Atendente");
  await page.goto(`/queue/${requestId}`);
  await page.getByRole("button", { name: "Iniciar atendimento" }).click();
  await expect(page.locator("p.feedback")).toHaveText("Atendimento iniciado.");
  await signOut(page);

  // The requester still gets the notification in the application (always on).
  await enterAs(page, "Solicitante");
  await expect(async () => {
    await page.goto("/notifications");
    await expect(page.locator("ul.notification-list > li").first()).toContainText("Atendimento iniciado");
  }).toPass({ timeout: 15_000 });
  await setStatusEmails(page, false);
  await signOut(page);

  // The administrator sees the delivery, not sent for lack of configuration, without its content.
  await enterAs(page, "Administrador");
  await page.goto("/admin?section=emails");
  await expect(page.getByRole("heading", { name: "E-mails" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Envio não configurado");
  const delivery = page.locator("ul.email-delivery-list > li").first();
  await expect(delivery).toContainText(
    "Não enviado · Atendimento iniciado para Ana Souza (ana.souza@exemplo.test)",
  );
  await expect(delivery).toContainText("0 tentativas · e-mail não configurado");
  await expect(page.locator("ul.email-delivery-list")).not.toContainText(unique);
});
