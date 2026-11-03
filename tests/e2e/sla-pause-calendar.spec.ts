import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "../../scripts/demo-data";
import { ENTRANCE } from "./entrance";

// SPEC 2026-11-03-pausa-sla-calendario, section 8 (SF-132): the administrator configures the
// calendar and a holiday and puts a service in business hours; the requester opens; the attendant
// pauses with a reason; the requester sees it and replies; the history shows the resume.
// The calendar counts every hour of every day, so the test does not depend on the time it runs.

const unique = `e2e-pausa-${Date.now()}`;
const service = `${unique} Conserto de cadeira`;
const description = `${unique} cadeira da sala 3 quebrada`;
const reason = "Qual é o número do patrimônio da cadeira?";

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

const slaLine = (page: Page) => page.locator("article .sla-line");

test("business-hours calendar and an SLA paused while waiting for the requester", async ({ page }) => {
  test.setTimeout(240_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  try {
    await seedDemoData(database);
  } finally {
    await database.$disconnect();
  }

  // Administrator: calendar, holiday and a service in business hours (CA-PSL-02 and 03).
  await enterAs(page, "Administrador");
  await page.goto("/admin?section=calendar");
  const hours = page.getByRole("form", { name: "Expediente" });
  for (const day of ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado", "Domingo"]) {
    await hours.getByLabel(day).check();
  }
  await hours.getByLabel("Início do expediente").fill("00:00");
  await hours.getByLabel("Fim do expediente").fill("24:00");
  await hours.getByRole("button", { name: "Salvar expediente" }).click();
  await expect(page.getByText("Expediente salvo. Vale para os próximos cálculos de prazo.")).toBeVisible();

  const holiday = page.getByRole("form", { name: "Novo feriado" });
  await holiday.getByLabel("Data").fill("2020-01-01");
  await holiday.getByLabel("Nome").fill(`${unique} Confraternização`);
  await holiday.getByRole("button", { name: "Cadastrar feriado" }).click();
  await expect(page.getByText("Feriado cadastrado.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Feriados cadastrados" })).toContainText(`${unique} Confraternização`);

  await page
    .getByRole("navigation", { name: "Seções administrativas" })
    .getByRole("link", { name: "Serviços", exact: true })
    .click();
  const form = page.getByRole("region", { name: "Serviços" }).locator("form").first();
  await form.locator('[name="name"]').fill(service);
  await form.locator('[name="description"]').fill("Serviço em horas úteis para o teste.");
  await form.locator('[name="categoryId"]').selectOption({ label: "Manutenção" });
  await form.locator('[name="sectorId"]').selectOption({ label: "Central de Serviços" });
  await form.locator('[name="slaHours"]').fill("8");
  await form.getByLabel("Contagem do prazo").selectOption({ label: "Horas úteis (calendário)" });
  await form.getByRole("button", { name: "Criar serviço" }).click();
  await expect(form.getByRole("status")).toHaveText("Registro criado.");
  await expect(page.getByText("Prazo-base: 8 h (horas úteis)")).toBeVisible();
  await signOut(page);

  // Requester opens: the due date says it counts business hours.
  await enterAs(page, "Solicitante");
  await page.goto("/catalog");
  await page.getByRole("link", { name: service }).click();
  await page.getByLabel("Descreva o que você precisa").fill(description);
  await page.getByRole("button", { name: "Enviar solicitação" }).click();
  await expect(page.getByRole("status")).toHaveText("Sua solicitação foi aberta.");
  const requestId = new URL(page.url()).pathname.split("/").at(-1)!;
  await expect(slaLine(page)).toContainText("Dentro do prazo");
  await expect(slaLine(page)).toContainText("(horas úteis)");
  await signOut(page);

  // Attendant assumes, starts and pauses with a reason (CA-PSL-05 and 06).
  await enterAs(page, "Atendente");
  await page.goto(`/queue/${requestId}`);
  await page.getByRole("button", { name: "Assumir" }).click();
  await expect(page.locator("p.feedback")).toHaveText("Você assumiu esta solicitação.");
  await page.getByRole("button", { name: "Iniciar atendimento" }).click();
  await expect(page.locator("p.feedback")).toHaveText("Atendimento iniciado.");
  await page.getByLabel("Motivo da pausa").fill(reason);
  await page.getByRole("button", { name: "Pausar prazo" }).click();
  await expect(page.locator("p.feedback")).toHaveText("Prazo pausado. O solicitante foi avisado.");
  await expect(slaLine(page)).toContainText("Prazo pausado");
  await expect(page.getByRole("button", { name: "Retomar prazo" })).toBeVisible();
  await page.goto(`/queue?q=${encodeURIComponent(unique)}&sla=paused`);
  await expect(page.locator("ul.content-list > li").filter({ hasText: description })).toContainText("Prazo pausado");
  await signOut(page);

  // Requester sees the reason and replies: the SLA runs again (CA-PSL-07).
  await enterAs(page, "Solicitante");
  await page.goto(`/requests/${requestId}`);
  await expect(slaLine(page)).toContainText("Prazo pausado");
  await expect(page.getByRole("note")).toContainText(`O atendimento aguarda sua resposta: ${reason}`);
  await page.getByLabel("Novo comentário").fill("Patrimônio 4521");
  await page.getByRole("button", { name: "Enviar comentário" }).click();
  await expect(page.locator("p.feedback")).toHaveText("Comentário enviado.");
  await expect(slaLine(page)).toContainText("Dentro do prazo");
  await expect(page.getByRole("note")).toHaveCount(0);
  await signOut(page);

  // Attendant sees the pause and the resume in the history (CA-PSL-08).
  await enterAs(page, "Atendente");
  await page.goto(`/queue/${requestId}`);
  const history = page.locator("ol.history-list");
  await expect(history).toContainText("Prazo pausado: aguardando o solicitante");
  await expect(history).toContainText(reason);
  await expect(history).toContainText("Prazo retomado pela resposta do solicitante");
  await expect(page.getByLabel("Motivo da pausa")).toBeVisible();
});
