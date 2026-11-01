import { expect, test, type Locator, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "../../scripts/demo-data";

// SPEC 2026-11-01-fluxos-configuraveis, section 8 (SF-080): the administrator creates a flow of
// three stages; the requester opens; the attendant starts, advances, goes back with a reason,
// advances to the last stage and completes; the requester sees the stages and the notification.

const unique = `e2e-etapas-${Date.now()}`;
const service = `${unique} Instalação de software`;
const description = `${unique} instalar o leitor de PDF`;

async function enterAs(page: Page, profile: "Administrador" | "Solicitante" | "Atendente") {
  await page.goto("/login");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration
  await page.getByRole("button", { name: `Entrar como ${profile}` }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login/);
}

function stagesPanel(page: Page): Locator {
  return page
    .locator("ul.entity-list > li")
    .filter({ hasText: service })
    .getByRole("region", { name: "Etapas do atendimento" });
}

test("attendance flow: stages configured, moved with history and seen by the requester", async ({ page }) => {
  test.setTimeout(240_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  try {
    await seedDemoData(database);
  } finally {
    await database.$disconnect();
  }

  // Administrator creates the service and a flow of three stages (CA-FLX-02).
  await enterAs(page, "Administrador");
  await page
    .getByRole("navigation", { name: "Seções administrativas" })
    .getByRole("link", { name: "Serviços", exact: true })
    .click();
  const form = page.getByRole("region", { name: "Serviços" }).locator("form").first();
  await form.locator('[name="name"]').fill(service);
  await form.locator('[name="description"]').fill("Serviço com fluxo para o teste.");
  await form.locator('[name="categoryId"]').selectOption({ label: "TI" });
  await form.locator('[name="sectorId"]').selectOption({ label: "Setor de demonstração" });
  await form.getByRole("button", { name: "Criar serviço" }).click();
  await expect(form.getByRole("status")).toHaveText("Registro criado.");

  for (const name of ["Triagem", "Instalação", "Validação"]) {
    await stagesPanel(page).locator('form.create-form [name="name"]').fill(name);
    await stagesPanel(page).getByRole("button", { name: "Adicionar etapa" }).click();
    await expect(stagesPanel(page).locator("ol.requirement-list")).toContainText(name);
  }
  await expect(stagesPanel(page)).toContainText("3 de 8 ativas");
  await signOut(page);

  // Requester opens a request.
  await enterAs(page, "Solicitante");
  await page.goto("/catalog");
  await page.getByRole("link", { name: service }).click();
  await page.getByLabel("Descreva o que você precisa").fill(description);
  await page.getByRole("button", { name: "Enviar solicitação" }).click();
  await expect(page.getByRole("status")).toHaveText("Sua solicitação foi aberta.");
  const requestId = new URL(page.url()).pathname.split("/").at(-1)!;
  await signOut(page);

  // Attendant starts: the flow is copied and the first stage entered (CA-FLX-04).
  await enterAs(page, "Atendente");
  await page.goto(`/queue/${requestId}`);
  await page.getByRole("button", { name: "Iniciar atendimento" }).click();
  await expect(page.getByRole("heading", { name: "Etapa 1 de 3: Triagem" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Concluir solicitação" })).toHaveCount(0);

  // Advances, goes back with a reason, advances to the last stage (CA-FLX-05, 08).
  await page.getByRole("button", { name: "Avançar para Instalação" }).click();
  await expect(page.locator("p.feedback")).toHaveText("Etapa alterada.");
  await page.getByText("Voltar para Triagem").click();
  await page.locator("#stage-note").fill("Falta a licença do software");
  await page.getByRole("button", { name: "Confirmar retorno para Triagem" }).click();
  await expect(page.getByRole("heading", { name: "Etapa 1 de 3: Triagem" })).toBeVisible();
  await page.getByRole("button", { name: "Avançar para Instalação" }).click();
  await page.getByRole("button", { name: "Avançar para Validação" }).click();
  await expect(page.getByRole("heading", { name: "Etapa 3 de 3: Validação" })).toBeVisible();
  await expect(page.getByText("Esta é a última etapa: a solicitação já pode ser concluída.")).toBeVisible();

  const history = page.locator("ol.history-list");
  await expect(history).toContainText("Etapa: Triagem");
  await expect(history).toContainText("Etapa: Instalação → Triagem");
  await expect(history).toContainText("Justificativa: Falta a licença do software");
  await expect(history).toContainText("Etapa: Instalação → Validação");

  // The queue shows the stage next to the status (CA-FLX-10).
  await page.goto(`/queue?q=${encodeURIComponent(unique)}`);
  await expect(page.locator("ul.content-list > li").filter({ hasText: description })).toContainText(
    "Etapa 3 de 3: Validação",
  );

  // Completes at the last stage (CA-FLX-06).
  await page.goto(`/queue/${requestId}`);
  await page.getByRole("button", { name: "Concluir solicitação" }).click();
  await expect(page.locator("p.feedback")).toHaveText("Solicitação concluída.");
  await signOut(page);

  // The requester sees the stages passed and is notified of the moves (CA-FLX-08, 10).
  await enterAs(page, "Solicitante");
  await page.goto(`/requests/${requestId}`);
  const steps = page.getByRole("list", { name: "Etapas do atendimento" });
  await expect(steps.locator("li")).toHaveText(["Triagem (concluída)", "Instalação (concluída)", "Validação (atual)"]);
  await page.goto(`/requests?q=${encodeURIComponent(unique)}`);
  await expect(page.locator("ul.content-list > li").filter({ hasText: service })).toContainText("Etapa 3 de 3: Validação");
  await page.goto("/notifications");
  await expect(page.getByText(`Sua solicitação passou para a etapa Validação: ${service}`)).toBeVisible();
  await expect(page.getByText(`Sua solicitação passou para a etapa Triagem: ${service}`)).toBeVisible();
});
