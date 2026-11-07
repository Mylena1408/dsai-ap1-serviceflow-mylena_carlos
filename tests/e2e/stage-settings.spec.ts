import { expect, test, type Locator, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { ENTRANCE } from "./entrance";
import { seedDemoData } from "../../scripts/demo-data";

// SPEC 2026-11-06-aprofundamento-configurabilidade, section 8, part C (SF-170; CA-ETP-02 to 06 through
// the screens): the administrator gives a stage an attendant, a target and a condition; the requester
// opens two requests; the attendant starts both; only the one that meets the condition gets the
// stage, and advancing hands it to the stage's attendant; the queue filters by the current stage.

const unique = `e2e-etapas-${Date.now()}`;
const service = `${unique} Conserto`;

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

function card(page: Page): Locator {
  return page.locator("ul.entity-list > li").filter({ hasText: service });
}

test("stage settings: attendant, target and condition, and the queue filter by stage", async ({ page }) => {
  test.setTimeout(240_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  const bia = `${unique} Bia`;
  try {
    await seedDemoData(database);
    const sector = await database.sector.findFirstOrThrow({ where: { name: "Central de Serviços" } });
    await database.user.create({
      data: { name: bia, email: `${unique}@example.test`, role: "ATTENDANT", sectorId: sector.id, passwordHash: "!e2e-unusable" },
    });
  } finally {
    await database.$disconnect();
  }

  // The administrator creates the service, a choice field and two stages (CA-ETP-02).
  await enterAs(page, "Administrador");
  await page.getByRole("navigation", { name: "Seções administrativas" }).getByRole("link", { name: "Serviços", exact: true }).click();
  const create = page.getByRole("region", { name: "Serviços" }).locator("form").first();
  await create.locator('[name="name"]').fill(service);
  await create.locator('[name="description"]').fill("Serviço com etapas configuradas.");
  await create.locator('[name="categoryId"]').selectOption({ label: "TI" });
  await create.locator('[name="sectorId"]').selectOption({ label: "Central de Serviços" });
  await create.getByRole("button", { name: "Criar serviço" }).click();
  await expect(create.getByRole("status")).toHaveText("Registro criado.");

  const fieldForm = card(page).getByRole("region", { name: "Campos do formulário" }).locator("form.create-form");
  await fieldForm.locator('[name="label"]').fill("Tipo");
  await fieldForm.locator('[name="type"]').selectOption("SELECT");
  await fieldForm.locator('[name="isRequired"]').selectOption("true");
  await fieldForm.locator('[name="options"]').fill("Hardware\nSoftware");
  await fieldForm.getByRole("button", { name: "Adicionar campo" }).click();
  await expect(card(page).getByRole("region", { name: "Campos do formulário" })).toContainText("Tipo");

  const stages = () => card(page).getByRole("region", { name: "Etapas do atendimento" });
  for (const name of ["Triagem", "Bancada"]) {
    await stages().locator('form.create-form [name="name"]').fill(name);
    await stages().getByRole("button", { name: "Adicionar etapa" }).click();
    await expect(stages().locator("ol.requirement-list")).toContainText(name);
  }
  await page.reload();
  await stages().locator("li").filter({ hasText: "Bancada" }).getByRole("button", { name: "Ajustes" }).click();
  const settings = page.getByRole("form", { name: "Ajustes da etapa Bancada" });
  await settings.locator('[name="assigneeId"]').selectOption({ label: bia });
  await settings.locator('[name="targetDays"]').fill("2");
  await settings.locator('[name="condition"]').selectOption({ label: "Tipo = Hardware" });
  await settings.getByRole("button", { name: "Salvar ajustes" }).click();
  await expect(stages()).toContainText(`Responsável: ${bia} · Prazo: 2 dias · Só quando Tipo = Hardware`);
  await signOut(page);

  // The requester opens one request of each type.
  await enterAs(page, "Solicitante");
  const ids: Record<string, string> = {};
  for (const kind of ["Hardware", "Software"]) {
    await page.goto("/catalog");
    await page.getByRole("link", { name: service }).click();
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Descreva o que você precisa").fill(`${unique} ${kind}`);
    await page.getByLabel("Tipo (obrigatório)").selectOption(kind);
    await page.getByRole("button", { name: "Enviar solicitação" }).click();
    await expect(page.getByRole("status")).toHaveText("Sua solicitação foi aberta.");
    ids[kind] = new URL(page.url()).pathname.split("/").at(-1)!;
  }
  await signOut(page);

  // The attendant starts both: only Hardware gets "Bancada" (CA-ETP-05).
  await enterAs(page, "Atendente");
  await page.goto(`/queue/${ids.Software}`);
  await page.getByRole("button", { name: "Iniciar atendimento" }).click();
  await expect(page.getByRole("heading", { name: "Etapa 1 de 1: Triagem" })).toBeVisible();

  await page.goto(`/queue/${ids.Hardware}`);
  await page.getByRole("button", { name: "Iniciar atendimento" }).click();
  await expect(page.getByRole("heading", { name: "Etapa 1 de 2: Triagem" })).toBeVisible();
  // Advancing hands it to Bia, the stage's attendant (CA-ETP-03).
  await page.getByRole("button", { name: "Avançar para Bancada" }).click();
  await expect(page.getByRole("region", { name: "Responsável" })).toContainText(bia);
  await expect(page.locator("ol.history-list")).toContainText("Etapa: Triagem → Bancada");

  // The queue filters by the current stage (CA-ETP-06).
  await page.goto(`/queue?q=${encodeURIComponent(unique)}`);
  await page.locator('[name="stage"]').selectOption("Bancada");
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page).toHaveURL(/stage=Bancada/);
  const list = page.locator("ul.content-list");
  await expect(list).toContainText(`${unique} Hardware`);
  await expect(list).not.toContainText(`${unique} Software`);
  await page.locator('[name="stage"]').selectOption("Triagem");
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(list).toContainText(`${unique} Software`);
  await expect(list).not.toContainText(`${unique} Hardware`);
});
