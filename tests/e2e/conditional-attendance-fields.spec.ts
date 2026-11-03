import { expect, test, type Locator, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "../../scripts/demo-data";
import { ENTRANCE } from "./entrance";

// SPEC 2026-11-03-campos-condicionais-atendimento, section 8 (SF-137): the administrator creates a
// multiple choice, a conditional field and a required attendance field; the requester sees the
// conditional field appear and opens; the attendant is refused at the completion, fills the
// attendance field and completes; the requester never sees the attendance field.

const unique = `e2e-condicionais-${Date.now()}`;
const service = `${unique} Empréstimo de equipamento`;
const description = `${unique} preciso de um notebook`;

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

function fieldsPanel(page: Page): Locator {
  return page.locator("ul.entity-list > li").filter({ hasText: service }).getByRole("region", { name: "Campos do formulário" });
}

async function addField(
  page: Page,
  field: { label: string; type: string; required: boolean; options?: string; audience?: "REQUESTER" | "ATTENDANT"; condition?: string },
) {
  const panel = fieldsPanel(page);
  const form = panel.locator("form.create-form");
  await form.locator('[name="label"]').fill(field.label);
  await form.locator('[name="type"]').selectOption(field.type);
  await form.locator('[name="isRequired"]').selectOption(field.required ? "true" : "false");
  if (field.options) await form.locator('[name="options"]').fill(field.options);
  if (field.audience) await form.locator('[name="audience"]').selectOption(field.audience);
  if (field.condition) await form.locator('[name="condition"]').selectOption({ label: field.condition });
  await form.getByRole("button", { name: "Adicionar campo" }).click();
  await expect(panel.locator("ol.requirement-list")).toContainText(field.label);
}

test("conditional field, multiple choice and a required attendance field", async ({ page }) => {
  test.setTimeout(240_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  try {
    await seedDemoData(database);
  } finally {
    await database.$disconnect();
  }

  // Administrator: the service and its four fields (CA-CND-02).
  await enterAs(page, "Administrador");
  await page.getByRole("navigation", { name: "Seções administrativas" }).getByRole("link", { name: "Serviços", exact: true }).click();
  const form = page.getByRole("region", { name: "Serviços" }).locator("form").first();
  await form.locator('[name="name"]').fill(service);
  await form.locator('[name="description"]').fill("Serviço com campos condicionais para o teste.");
  await form.locator('[name="categoryId"]').selectOption({ label: "TI" });
  await form.locator('[name="sectorId"]').selectOption({ label: "Central de Serviços" });
  await form.getByRole("button", { name: "Criar serviço" }).click();
  await expect(form.getByRole("status")).toHaveText("Registro criado.");

  await addField(page, { label: "Tipo", type: "SELECT", required: true, options: "Notebook\nDesktop" });
  await addField(page, { label: "Acessórios", type: "MULTI_SELECT", required: false, options: "Mouse\nTeclado\nMonitor" });
  await addField(page, { label: "Carregador", type: "SHORT_TEXT", required: true, condition: "Tipo = Notebook" });
  await addField(page, { label: "Número do patrimônio entregue", type: "SHORT_TEXT", required: true, audience: "ATTENDANT" });
  const panel = fieldsPanel(page);
  await expect(panel).toContainText("Mostrar só quando Tipo = Notebook");
  await expect(panel).toContainText("Quem preenche: Atendimento");
  await signOut(page);

  // Requester: the conditional field appears only with "Notebook"; the attendance field never (CA-CND-05).
  await enterAs(page, "Solicitante");
  await page.goto("/catalog");
  await page.getByRole("link", { name: service }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByLabel("Tipo (obrigatório)")).toBeVisible();
  await expect(page.getByText("Número do patrimônio entregue")).toHaveCount(0);
  const charger = page.getByLabel("Carregador (obrigatório)");
  await expect(charger).toBeHidden();
  await page.getByLabel("Tipo (obrigatório)").selectOption("Desktop");
  await expect(charger).toBeHidden();
  await page.getByLabel("Tipo (obrigatório)").selectOption("Notebook");
  await expect(charger).toBeVisible();
  await charger.fill("65 W");
  await page.getByRole("checkbox", { name: "Mouse" }).check();
  await page.getByRole("checkbox", { name: "Monitor" }).check();
  await page.getByLabel("Descreva o que você precisa").fill(description);
  await page.getByRole("button", { name: "Enviar solicitação" }).click();
  await expect(page.getByRole("status")).toHaveText("Sua solicitação foi aberta.");
  const requestId = new URL(page.url()).pathname.split("/").at(-1)!;
  const answers = page.getByRole("region", { name: "Informações do serviço" });
  await expect(answers).toContainText("Mouse, Monitor");
  await expect(answers).toContainText("65 W");
  await signOut(page);

  // Attendant: the completion is refused until the attendance field is filled (CA-CND-06 and 07).
  await enterAs(page, "Atendente");
  await page.goto(`/queue/${requestId}`);
  await page.getByRole("button", { name: "Assumir" }).click();
  await expect(page.locator("p.feedback")).toHaveText("Você assumiu esta solicitação.");
  await page.getByRole("button", { name: "Iniciar atendimento" }).click();
  await expect(page.locator("p.feedback")).toHaveText("Atendimento iniciado.");
  await page.getByRole("button", { name: "Concluir solicitação" }).click();
  await expect(page.locator("p.feedback-error")).toHaveText("Preencha as informações do atendimento obrigatórias antes de concluir.");

  const attendance = page.getByRole("region", { name: "Informações do atendimento" });
  await attendance.getByLabel("Número do patrimônio entregue (obrigatório)").fill("NB-0042");
  await attendance.getByRole("button", { name: "Salvar informações do atendimento" }).click();
  await expect(page.locator("p.feedback")).toHaveText("Informações do atendimento salvas.");
  await expect(page.getByRole("region", { name: "Informações do atendimento" }).getByLabel("Número do patrimônio entregue (obrigatório)")).toHaveValue(
    "NB-0042",
  );
  await expect(page.locator("ol.history-list")).toContainText("Informações do atendimento atualizadas: Número do patrimônio entregue");
  await expect(page.locator("ol.history-list")).not.toContainText("NB-0042");
  await page.getByRole("button", { name: "Concluir solicitação" }).click();
  await expect(page.locator("p.feedback")).toHaveText("Solicitação concluída.");
  await signOut(page);

  // Requester: nothing of the attendance (CA-CND-08).
  await enterAs(page, "Solicitante");
  await page.goto(`/requests/${requestId}`);
  await expect(page.locator("body")).not.toContainText("NB-0042");
  await expect(page.locator("body")).not.toContainText("Número do patrimônio entregue");
  await expect(page.locator("body")).not.toContainText("Informações do atendimento");
});
