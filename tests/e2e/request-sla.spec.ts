import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "../../scripts/demo-data";

// SPEC 2026-11-01-sla-prioridades, section 8 (SF-070): the administrator sets a short SLA,
// the requester opens a request, the attendant sees the situation and changes the priority,
// and the due date changes.

const unique = `e2e-sla-${Date.now()}`;
const service = `${unique} Troca de lâmpada`;
const description = `${unique} lâmpada da sala 2 queimada`;

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

const slaLine = (page: Page) => page.locator("article .sla-line");
const dueText = async (page: Page) => (await slaLine(page).locator("time").getAttribute("datetime"))!;

test("short SLA: situation on screens, priority change and new due date", async ({ page }) => {
  test.setTimeout(240_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  try {
    await seedDemoData(database);
  } finally {
    await database.$disconnect();
  }

  // Administrator creates a service with a 2-hour base SLA (CA-SLA-02).
  await enterAs(page, "Administrador");
  await page
    .getByRole("navigation", { name: "Seções administrativas" })
    .getByRole("link", { name: "Serviços", exact: true })
    .click();
  const form = page.getByRole("region", { name: "Serviços" }).locator("form").first();
  await form.locator('[name="name"]').fill(service);
  await form.locator('[name="description"]').fill("Serviço com prazo curto para o teste.");
  await form.locator('[name="categoryId"]').selectOption({ label: "Manutenção" });
  await form.locator('[name="sectorId"]').selectOption({ label: "Setor de demonstração" });
  await form.locator('[name="defaultPriority"]').selectOption("NORMAL");
  await form.locator('[name="slaHours"]').fill("2");
  await form.getByRole("button", { name: "Criar serviço" }).click();
  await expect(form.getByRole("status")).toHaveText("Registro criado.");
  await signOut(page);

  // Requester opens it: Normal priority, on time, due in 2 hours (CA-SLA-03).
  await enterAs(page, "Solicitante");
  await page.goto("/catalog");
  await page.getByRole("link", { name: service }).click();
  await page.getByLabel("Descreva o que você precisa").fill(description);
  await page.getByRole("button", { name: "Enviar solicitação" }).click();
  await expect(page.getByRole("status")).toHaveText("Sua solicitação foi aberta.");
  const requestId = new URL(page.url()).pathname.split("/").at(-1)!;
  await expect(slaLine(page)).toContainText("Prioridade: Normal");
  await expect(slaLine(page)).toContainText("Dentro do prazo");
  const firstDue = new Date(await dueText(page));
  await signOut(page);

  // Attendant sees the situation in the queue, filters by it and changes the priority.
  await enterAs(page, "Atendente");
  await page.goto(`/queue?q=${encodeURIComponent(unique)}&sla=on_time&order=due`);
  const item = page.locator("ul.content-list > li").filter({ hasText: description });
  await expect(item).toContainText("Prioridade: Normal");
  await expect(item).toContainText("Dentro do prazo");
  await expect(page.getByLabel("Situação do prazo")).toHaveValue("on_time");
  await page.goto(`/queue?q=${encodeURIComponent(unique)}&sla=overdue`);
  await expect(page.getByText("Nenhuma solicitação encontrada com esses critérios.")).toBeVisible();

  await page.goto(`/queue/${requestId}`);
  await page.getByLabel(/Prioridade \(atual: Normal\)/).selectOption("URGENT");
  await page.getByRole("button", { name: "Alterar prioridade" }).click();
  await expect(page.locator("p.feedback")).toHaveText("Prioridade alterada.");
  await expect(slaLine(page)).toContainText("Prioridade: Urgente");
  await expect(page.locator("ol.history-list")).toContainText("Prioridade: Normal → Urgente");
  // Urgent is 25% of the base SLA, counted from the opening: 30 minutes instead of 120.
  const newDue = new Date(await dueText(page));
  expect(firstDue.getTime() - newDue.getTime()).toBe(90 * 60 * 1000);
  await signOut(page);

  // The requester sees the new priority in the list.
  await enterAs(page, "Solicitante");
  await page.goto(`/requests?q=${encodeURIComponent(unique)}`);
  await expect(page.locator("ul.content-list > li").filter({ hasText: service })).toContainText("Prioridade: Urgente");
});
