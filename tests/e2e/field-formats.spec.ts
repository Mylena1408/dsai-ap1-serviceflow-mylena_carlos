import { expect, test, type Locator, type Page } from "@playwright/test";
import { ENTRANCE } from "./entrance";
import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "../../scripts/demo-data";

// SPEC 2026-11-06-aprofundamento-configurabilidade, section 8, part A (SF-163; CA-CMP-01 to 05 through
// the screens): the administrator creates a decimal, a CPF and a phone field; the requester is
// refused with fixed messages, corrects, opens, reads the formatted answers and finds the request
// by the CPF digits.

const unique = `e2e-formatos-${Date.now()}`;
const service = `${unique} Reembolso`;
const description = `${unique} táxi para o aeroporto`;

async function enterAs(page: Page, profile: "Administrador" | "Solicitante") {
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

async function addField(page: Page, field: { label: string; type: string; places?: string; min?: string; max?: string }) {
  const panel = fieldsPanel(page);
  const form = panel.locator("form.create-form");
  await form.locator('[name="label"]').fill(field.label);
  await form.locator('[name="type"]').selectOption(field.type);
  await form.locator('[name="isRequired"]').selectOption("true");
  if (field.places) await form.locator('[name="decimalPlaces"]').selectOption(field.places);
  if (field.min) await form.locator('[name="minDecimal"]').fill(field.min);
  if (field.max) await form.locator('[name="maxDecimal"]').fill(field.max);
  await form.getByRole("button", { name: "Adicionar campo" }).click();
  await expect(panel.locator("ol.requirement-list")).toContainText(field.label);
}

test("decimal and formatted fields: configuration, refusals, formatted answers and search", async ({ page }) => {
  test.setTimeout(240_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  try {
    await seedDemoData(database);
  } finally {
    await database.$disconnect();
  }

  // The administrator creates the service and the three fields (CA-CMP-01).
  await enterAs(page, "Administrador");
  await page.getByRole("navigation", { name: "Seções administrativas" }).getByRole("link", { name: "Serviços", exact: true }).click();
  const form = page.getByRole("region", { name: "Serviços" }).locator("form").first();
  await form.locator('[name="name"]').fill(service);
  await form.locator('[name="description"]').fill("Serviço com campos de formato para o teste.");
  await form.locator('[name="categoryId"]').selectOption({ label: "TI" });
  await form.locator('[name="sectorId"]').selectOption({ label: "Central de Serviços" });
  await form.getByRole("button", { name: "Criar serviço" }).click();
  await expect(form.getByRole("status")).toHaveText("Registro criado.");

  await addField(page, { label: "Valor", type: "DECIMAL", places: "2", min: "0", max: "1500,5" });
  await addField(page, { label: "CPF do passageiro", type: "CPF" });
  await addField(page, { label: "Telefone", type: "PHONE" });
  await expect(fieldsPanel(page)).toContainText("2 casas decimais; de 0,00 a 1.500,50");
  await signOut(page);

  // The requester is refused by the server with fixed messages (CA-CMP-02 and 03).
  await enterAs(page, "Solicitante");
  await page.goto("/catalog");
  await page.getByRole("link", { name: service }).click();
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Descreva o que você precisa").fill(description);
  const value = page.getByLabel("Valor (obrigatório)");
  const cpf = page.getByLabel("CPF do passageiro (obrigatório)");
  const phone = page.getByLabel("Telefone (obrigatório)");
  await value.fill("10,255");
  await cpf.fill("529.982.247-24");
  await phone.fill("3201-7000");
  await page.locator("form.request-form").evaluate((element) => ((element as HTMLFormElement).noValidate = true));
  await page.getByRole("button", { name: "Enviar solicitação" }).click();

  await expect(page).toHaveURL(/error=fields/);
  expect(page.url()).not.toContain("529");
  await expect(page.locator(".custom-field").filter({ has: value })).toContainText("Use no máximo 2 casas decimais.");
  await expect(page.locator(".custom-field").filter({ has: cpf })).toContainText("Informe um CPF válido.");
  await expect(page.locator(".custom-field").filter({ has: phone })).toContainText("Informe o telefone com DDD, com 10 ou 11 dígitos.");

  // Corrects and opens; the answers come back formatted.
  await value.fill("1234,5");
  await cpf.fill("529.982.247-25");
  await phone.fill("+55 (91) 98765-4321");
  await page.getByRole("button", { name: "Enviar solicitação" }).click();
  await expect(page.getByRole("status")).toHaveText("Sua solicitação foi aberta.");
  const answers = page.getByRole("region", { name: "Informações do serviço" });
  await expect(answers.locator("dd")).toHaveText(["1.234,50", "529.982.247-25", "(91) 98765-4321"]);

  // The search finds it by the CPF digits, written with or without punctuation (CA-CMP-05).
  // The list shows the service name (the demo requester has no other request of this service).
  await page.goto(`/requests?q=${encodeURIComponent("529.982.247")}`);
  await expect(page.getByRole("main")).toContainText(service);
  await page.goto(`/requests?q=${encodeURIComponent("98765")}`);
  await expect(page.getByRole("main")).toContainText(service);
  await page.goto(`/requests?q=${encodeURIComponent(`${unique} inexistente`)}`);
  await expect(page.getByRole("main")).not.toContainText(service);
});
