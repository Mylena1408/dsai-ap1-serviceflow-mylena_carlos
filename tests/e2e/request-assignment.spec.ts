import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "../../scripts/demo-data";

// SPEC 2026-10-31, section 9 (SF-052): assume and transfer, colleague completes only after
// the transfer, requester cancels an open request and reopens a completed one.

const unique = `e2e-atr-${Date.now()}`;
const colleagueName = `${unique} Colega`;
const colleagueEmail = `${unique}@example.test`;
const colleaguePassword = "E2E-only-colleague-password";
const service = "Reparo de mobiliário";
const demoAttendant = "Atendente (demonstração)";

async function enterAs(page: Page, profile: "Administrador" | "Solicitante" | "Atendente") {
  await page.goto("/login");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration
  await page.getByRole("button", { name: `Entrar como ${profile}` }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function signInWithPassword(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByText("Entrar com e-mail e senha").click();
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/queue/);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login/);
}

async function openRequest(page: Page, description: string): Promise<string> {
  await page.goto("/catalog");
  await page.getByRole("link", { name: service }).first().click();
  await page.getByLabel("Descreva o que você precisa").fill(description);
  await page.getByRole("button", { name: "Enviar solicitação" }).click();
  await expect(page.getByRole("status")).toHaveText("Sua solicitação foi aberta.");
  return new URL(page.url()).pathname.split("/").at(-1)!;
}

const statusPill = (page: Page) => page.locator("article .status-pill");
const feedback = (page: Page) => page.locator("p.feedback");

test("assignment, transfer, cancellation and reopening across profiles", async ({ page }) => {
  test.setTimeout(240_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  try {
    await seedDemoData(database);
  } finally {
    await database.$disconnect();
  }

  // Administrator adds a second attendant to the demonstration sector.
  await enterAs(page, "Administrador");
  await page
    .getByRole("navigation", { name: "Seções administrativas" })
    .getByRole("link", { name: "Usuários", exact: true })
    .click();
  const userForm = page.getByRole("region", { name: "Usuários" }).locator("form").first();
  await userForm.locator('[name="name"]').fill(colleagueName);
  await userForm.locator('[name="email"]').fill(colleagueEmail);
  await userForm.locator('[name="password"]').fill(colleaguePassword);
  await userForm.locator('[name="role"]').selectOption("ATTENDANT");
  await userForm.locator('[name="sectorId"]').selectOption({ label: "Setor de demonstração" });
  await userForm.getByRole("button", { name: "Criar usuário" }).click();
  await expect(userForm.getByRole("status")).toHaveText("Registro criado.");
  await signOut(page);

  // Requester opens two requests and cancels one while it is still open (CA-ATR-06).
  await enterAs(page, "Solicitante");
  const keptId = await openRequest(page, `${unique} cadeira quebrada`);
  const cancelledId = await openRequest(page, `${unique} pedido duplicado`);
  await page.getByText("Cancelar solicitação").click();
  await page.getByLabel("Motivo (opcional)").fill("Abri em duplicidade");
  await page.getByRole("button", { name: "Confirmar cancelamento" }).click();
  await expect(feedback(page)).toHaveText("Sua solicitação foi cancelada.");
  await expect(statusPill(page)).toHaveText("Cancelada");
  await expect(page.getByText("Justificativa: Abri em duplicidade")).toBeVisible();
  await signOut(page);

  // Attendant assumes and transfers; then only the colleague may start (CA-ATR-01, 03, 05).
  await enterAs(page, "Atendente");
  await page.goto(`/queue/${keptId}`);
  await page.getByRole("button", { name: "Assumir" }).click();
  await expect(feedback(page)).toHaveText("Você assumiu esta solicitação.");
  await page.getByLabel("Transferir para").selectOption({ label: colleagueName });
  await page.getByRole("button", { name: "Transferir" }).click();
  await expect(feedback(page)).toHaveText("Solicitação transferida.");
  await expect(
    page.getByText(`Somente o responsável, ${colleagueName}, pode iniciar ou concluir esta solicitação.`),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Iniciar atendimento" })).toHaveCount(0);
  await page.goto(`/queue/${cancelledId}`);
  await expect(statusPill(page)).toHaveText("Cancelada");
  await expect(page.getByRole("button", { name: "Assumir" })).toHaveCount(0);
  await signOut(page);

  // The colleague starts and completes the transferred request.
  await signInWithPassword(page, colleagueEmail, colleaguePassword);
  await page.goto(`/queue/${keptId}`);
  await expect(page.getByText(`${colleagueName} (você)`)).toBeVisible();
  await page.getByRole("button", { name: "Iniciar atendimento" }).click();
  await expect(feedback(page)).toHaveText("Atendimento iniciado.");
  await page.getByRole("button", { name: "Concluir solicitação" }).click();
  await expect(feedback(page)).toHaveText("Solicitação concluída.");
  await signOut(page);

  // Requester reopens within 7 days; the history shows the whole path (CA-ATR-09, 12).
  await enterAs(page, "Solicitante");
  await page.goto(`/requests/${keptId}`);
  await expect(page.getByText(`Atendente responsável: ${colleagueName}`)).toBeVisible();
  await page.getByText("Reabrir solicitação").click();
  await page.getByLabel("O que ainda não foi resolvido? (obrigatório)").fill("O encosto soltou de novo");
  await page.getByRole("button", { name: "Reabrir" }).click();
  await expect(feedback(page)).toHaveText("Sua solicitação foi reaberta.");
  await expect(statusPill(page)).toHaveText("Aberta");
  const history = page.locator("ol.history-list > li");
  await expect(history.nth(0)).toContainText("Solicitação aberta: Aberta");
  await expect(history.nth(1)).toContainText(`Assumida por ${demoAttendant}`);
  await expect(history.nth(2)).toContainText(`Transferida de ${demoAttendant} para ${colleagueName}`);
  await expect(history.nth(3)).toContainText("Aberta → Em atendimento");
  await expect(history.nth(4)).toContainText("Em atendimento → Concluída");
  await expect(history.nth(5)).toContainText("Concluída → Aberta");
  await expect(history.nth(5)).toContainText("Justificativa: O encosto soltou de novo");
  await signOut(page);

  // The reopened request is back in the colleague's queue, still assigned to them.
  await signInWithPassword(page, colleagueEmail, colleaguePassword);
  // The queue has 20 items per page; the search keeps the check independent of other specs.
  await page.goto(`/queue?q=${encodeURIComponent(unique)}&assignee=mine`);
  const item = page.locator("ul.content-list > li").filter({ hasText: `${unique} cadeira quebrada` });
  await expect(item).toContainText("Aberta");
  await expect(item).toContainText("Responsável: você");
});
