import { expect, test, type Locator, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "../../scripts/demo-data";

// SPEC 2026-11-01-campos-personalizados, section 8 (SF-075): the administrator creates a service
// with one field of each type; the requester is refused without a required field, keeps what was
// typed, corrects and opens; the attendant sees the answers.

const unique = `e2e-campos-${Date.now()}`;
const service = `${unique} Troca de equipamento`;
const description = `${unique} monitor com defeito`;

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

function fieldsPanel(page: Page): Locator {
  return page
    .locator("ul.entity-list > li")
    .filter({ hasText: service })
    .getByRole("region", { name: "Campos do formulário" });
}

async function addField(
  page: Page,
  field: { label: string; type: string; required: boolean; options?: string; min?: string; max?: string },
) {
  const panel = fieldsPanel(page);
  const form = panel.locator("form.create-form");
  await form.locator('[name="label"]').fill(field.label);
  await form.locator('[name="type"]').selectOption(field.type);
  await form.locator('[name="isRequired"]').selectOption(field.required ? "true" : "false");
  if (field.options) await form.locator('[name="options"]').fill(field.options);
  if (field.min) await form.locator('[name="minValue"]').fill(field.min);
  if (field.max) await form.locator('[name="maxValue"]').fill(field.max);
  await form.getByRole("button", { name: "Adicionar campo" }).click();
  await expect(panel.locator("ol.requirement-list")).toContainText(field.label);
}

test("custom fields: configuration, refused opening with kept values and answers for the attendant", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  try {
    await seedDemoData(database);
  } finally {
    await database.$disconnect();
  }

  // Administrator creates the service and one field of each type (CA-FLD-02).
  await enterAs(page, "Administrador");
  await page
    .getByRole("navigation", { name: "Seções administrativas" })
    .getByRole("link", { name: "Serviços", exact: true })
    .click();
  const form = page.getByRole("region", { name: "Serviços" }).locator("form").first();
  await form.locator('[name="name"]').fill(service);
  await form.locator('[name="description"]').fill("Serviço com campos para o teste.");
  await form.locator('[name="categoryId"]').selectOption({ label: "TI" });
  await form.locator('[name="sectorId"]').selectOption({ label: "Setor de demonstração" });
  await form.getByRole("button", { name: "Criar serviço" }).click();
  await expect(form.getByRole("status")).toHaveText("Registro criado.");

  await addField(page, { label: "Patrimônio", type: "SHORT_TEXT", required: true });
  await addField(page, { label: "Detalhes do defeito", type: "LONG_TEXT", required: false });
  await addField(page, { label: "Quantidade", type: "INTEGER", required: true, min: "1", max: "5" });
  await addField(page, { label: "Data desejada", type: "DATE", required: false });
  await addField(page, { label: "Turno", type: "SELECT", required: true, options: "Manhã\nTarde" });
  await addField(page, { label: "Precisa de instalação?", type: "YES_NO", required: true });
  await expect(fieldsPanel(page)).toContainText("6 de 10 ativos");
  await signOut(page);

  // Requester sees the fields in order (CA-FLD-04) and is refused by the server (CA-FLD-05, 07).
  await enterAs(page, "Solicitante");
  await page.goto("/catalog");
  await page.getByRole("link", { name: service }).click();
  await page.waitForLoadState("networkidle");
  const labels = page.locator(".custom-field > label");
  await expect(labels).toHaveText([
    "Patrimônio (obrigatório)",
    "Detalhes do defeito (opcional)",
    "Quantidade (obrigatório)",
    "Data desejada (opcional)",
    "Turno (obrigatório)",
    "Precisa de instalação? (obrigatório)",
  ]);

  await page.getByLabel("Descreva o que você precisa").fill(description);
  await page.getByLabel("Detalhes do defeito (opcional)").fill("Tela piscando\ndesde ontem");
  await page.getByLabel("Quantidade (obrigatório)").fill("9");
  await page.getByLabel("Data desejada (opcional)").fill("2026-12-01");
  await page.getByLabel("Turno (obrigatório)").selectOption("Tarde");
  await page.getByLabel("Precisa de instalação? (obrigatório)").selectOption("true");
  // "Patrimônio" stays blank. The browser checks are turned off so the server answers.
  await page.locator("form.request-form").evaluate((element) => ((element as HTMLFormElement).noValidate = true));
  await page.getByRole("button", { name: "Enviar solicitação" }).click();

  await expect(page).toHaveURL(/error=fields/);
  expect(page.url()).not.toContain("Tela");
  await expect(page.locator("p.feedback-error")).toHaveText("Confira os campos indicados abaixo.");
  const asset = page.getByLabel("Patrimônio (obrigatório)");
  const quantity = page.getByLabel("Quantidade (obrigatório)");
  await expect(asset).toHaveAttribute("aria-invalid", "true");
  await expect(quantity).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator(".custom-field").filter({ has: asset })).toContainText("Preencha este campo.");
  await expect(page.locator(".custom-field").filter({ has: quantity })).toContainText("Informe um número de 1 a 5.");
  await expect(page.getByLabel("Descreva o que você precisa")).toHaveValue(description);
  await expect(page.getByLabel("Detalhes do defeito (opcional)")).toHaveValue("Tela piscando\ndesde ontem");
  await expect(quantity).toHaveValue("9");
  await expect(page.getByLabel("Data desejada (opcional)")).toHaveValue("2026-12-01");
  await expect(page.getByLabel("Turno (obrigatório)")).toHaveValue("Tarde");
  await expect(page.getByLabel("Precisa de instalação? (obrigatório)")).toHaveValue("true");

  // Corrects and opens (CA-FLD-08).
  await asset.fill("PAT-0042");
  await quantity.fill("2");
  await page.getByRole("button", { name: "Enviar solicitação" }).click();
  await expect(page.getByRole("status")).toHaveText("Sua solicitação foi aberta.");
  const requestId = new URL(page.url()).pathname.split("/").at(-1)!;
  const requesterAnswers = page.getByRole("region", { name: "Informações do serviço" });
  await expect(requesterAnswers.locator("dt")).toHaveText([
    "Patrimônio",
    "Detalhes do defeito",
    "Quantidade",
    "Data desejada",
    "Turno",
    "Precisa de instalação?",
  ]);
  await expect(requesterAnswers.locator("dd")).toHaveText([
    "PAT-0042",
    "Tela piscando\ndesde ontem",
    "2",
    "01/12/2026",
    "Tarde",
    "Sim",
  ]);
  await signOut(page);

  // The attendant of the sector sees the same answers (CA-FLD-09).
  await enterAs(page, "Atendente");
  await page.goto(`/queue/${requestId}`);
  const attendantAnswers = page.getByRole("region", { name: "Informações do serviço" });
  await expect(attendantAnswers).toContainText("PatrimônioPAT-0042");
  await expect(attendantAnswers).toContainText("Data desejada01/12/2026");
  await expect(attendantAnswers).toContainText("Precisa de instalação?Sim");
});
