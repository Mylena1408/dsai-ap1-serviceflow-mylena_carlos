import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "../../scripts/demo-data";

// SPEC 2026-11-01-aprovacoes, section 8 (SF-086): the administrator marks a service as requiring
// approval; the requester opens two requests; the attendant cannot start them; the manager
// rejects one and approves the other; the attendant starts the approved one; the requester sees
// the decisions and the notifications.

const unique = `e2e-aprovacao-${Date.now()}`;
const service = `${unique} Compra de equipamento`;

async function enterAs(page: Page, profile: "Administrador" | "Solicitante" | "Atendente" | "Gestor") {
  await page.goto("/login");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration
  await page.getByRole("button", { name: `Entrar como ${profile}` }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login/);
}

async function openRequest(page: Page, description: string): Promise<string> {
  await page.goto("/catalog");
  await page.getByRole("link", { name: service }).click();
  await page.getByLabel("Descreva o que você precisa").fill(description);
  await page.getByRole("button", { name: "Enviar solicitação" }).click();
  await expect(page.getByRole("status")).toHaveText("Sua solicitação foi aberta.");
  await expect(page.locator("article")).toContainText("Aguardando aprovação");
  return new URL(page.url()).pathname.split("/").at(-1)!;
}

test("approvals: blocked start, manager decisions and what each profile sees", async ({ page }) => {
  test.setTimeout(300_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  try {
    await seedDemoData(database);
  } finally {
    await database.$disconnect();
  }

  // The demonstration manager exists from its first sign-in (CA-APR-03).
  await enterAs(page, "Gestor");
  await expect(page.getByRole("heading", { name: "Aprovações", level: 1 })).toBeVisible();
  await signOut(page);

  // Administrator creates a service that requires approval (CA-APR-02).
  await enterAs(page, "Administrador");
  await page
    .getByRole("navigation", { name: "Seções administrativas" })
    .getByRole("link", { name: "Serviços", exact: true })
    .click();
  const form = page.getByRole("region", { name: "Serviços" }).locator("form").first();
  await form.locator('[name="name"]').fill(service);
  await form.locator('[name="description"]').fill("Serviço com aprovação para o teste.");
  await form.locator('[name="categoryId"]').selectOption({ label: "TI" });
  await form.locator('[name="sectorId"]').selectOption({ label: "Setor de demonstração" });
  await form.locator('[name="slaHours"]').fill("8");
  await form.getByLabel("Exige aprovação do gestor").check();
  await form.getByRole("button", { name: "Criar serviço" }).click();
  await expect(form.getByRole("status")).toHaveText("Registro criado.");
  const item = page.locator("ul.entity-list > li").filter({ hasText: service });
  await expect(item).toContainText("Exige aprovação do gestor");
  await expect(item).toContainText("Gestores ativos no setor: 1.");
  await signOut(page);

  // Requester opens two requests, both pending and without a due date (CA-APR-04, 07).
  await enterAs(page, "Solicitante");
  const approvedId = await openRequest(page, `${unique} notebook para o estagiário`);
  await expect(page.locator("article")).toContainText("Sem prazo");
  const rejectedId = await openRequest(page, `${unique} segundo monitor`);
  await signOut(page);

  // The attendant cannot start while the approval is pending (CA-APR-05).
  await enterAs(page, "Atendente");
  await page.goto(`/queue/${approvedId}`);
  await expect(page.getByText("O atendimento só pode começar depois da aprovação do gestor do setor.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Iniciar atendimento" })).toHaveCount(0);
  await signOut(page);

  // The manager sees both, is notified, rejects one and approves the other (CA-APR-06, 08, 09).
  await enterAs(page, "Gestor");
  const pending = page.locator("ul.content-list");
  await expect(pending).toContainText(`${unique} notebook para o estagiário`);
  await expect(pending).toContainText(`${unique} segundo monitor`);
  await page.goto("/approvals/notifications");
  await expect(page.getByText(`Aprovação pendente: ${service}`)).toHaveCount(2);

  await page.goto(`/approvals/${rejectedId}`);
  await page.getByText("Rejeitar", { exact: true }).click();
  await page.getByLabel("Observação (obrigatória)").fill("Já existe um monitor reserva no setor");
  await page.getByRole("button", { name: "Confirmar rejeição" }).click();
  await expect(page.locator("p.feedback")).toHaveText("Solicitação rejeitada.");
  await expect(page.locator("article")).toContainText("Rejeitada");
  await expect(page.locator("ol.history-list")).toContainText("Rejeitada por Gestor (demonstração)");
  await expect(page.locator("ol.history-list")).toContainText("Observação: Já existe um monitor reserva no setor");

  await page.goto(`/approvals/${approvedId}`);
  await page.getByLabel("Observação (opcional)").fill("Dentro do orçamento do trimestre");
  await page.getByRole("button", { name: "Aprovar" }).click();
  await expect(page.locator("p.feedback")).toHaveText("Solicitação aprovada.");
  await expect(page.getByRole("button", { name: "Aprovar" })).toHaveCount(0);

  await page.goto("/approvals");
  await expect(page.getByText("Nenhuma aprovação pendente.")).toBeVisible();
  await page.goto("/approvals?filter=all");
  await expect(page.locator("ul.content-list")).toContainText("Aprovada");
  await expect(page.locator("ul.content-list")).toContainText("Rejeitada");
  await signOut(page);

  // The attendant starts the approved request, which now has a due date (CA-APR-05, 07).
  await enterAs(page, "Atendente");
  await page.goto(`/queue/${approvedId}`);
  await expect(page.locator("article")).toContainText("Aprovada");
  await expect(page.locator("article")).toContainText("Dentro do prazo");
  await page.getByRole("button", { name: "Iniciar atendimento" }).click();
  await expect(page.locator("p.feedback")).toHaveText("Atendimento iniciado.");
  await signOut(page);

  // The requester sees both decisions and is notified of each (CA-APR-08).
  await enterAs(page, "Solicitante");
  await page.goto(`/requests/${rejectedId}`);
  await expect(page.locator("article")).toContainText("Cancelada");
  await expect(page.locator("article")).toContainText("Rejeitada");
  await page.goto("/notifications");
  await expect(page.getByText(`Solicitação rejeitada: ${service}`)).toBeVisible();
  await expect(page.getByText(`Solicitação aprovada: ${service}`)).toBeVisible();
  await expect(page.getByText(`Solicitação cancelada: ${service}`)).toHaveCount(0);
});
