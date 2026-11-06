import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "../../scripts/demo-data";
import { ENTRANCE } from "./entrance";

// SPEC 2026-11-06-respostas-prontas, section 7 (SF-153): the attendant creates a canned response,
// inserts it into a comment, adjusts it and sends it; the requester reads it with her own name.

const unique = `e2e-respostas-${Date.now()}`;
const title = `Visita ${unique}`;

async function enterAs(page: Page, profile: "Solicitante" | "Atendente" | "Gestor") {
  await page.goto("/");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration
  await page.getByRole("button", { name: `Entrar como ${profile}` }).click();
  await expect(page).not.toHaveURL(ENTRANCE);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(ENTRANCE);
}

test("an attendant inserts a canned response into a comment and the requester reads it", async ({ page }) => {
  test.setTimeout(180_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  let requestId: string;
  let requesterFirstName: string;
  try {
    await seedDemoData(database);
    const request = await database.request.findFirstOrThrow({
      where: { status: "OPEN", sector: { name: "Central de Serviços" }, requester: { email: { contains: "ana" } } },
      include: { requester: true },
    });
    requestId = request.id;
    requesterFirstName = request.requester.name.split(" ")[0]!;
  } finally {
    await database.$disconnect();
  }

  await enterAs(page, "Atendente");
  await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Respostas prontas" }).click();
  await expect(page.getByRole("heading", { name: "Respostas prontas" })).toBeVisible();
  await page.getByLabel("Título").first().fill(title);
  await page.getByLabel("Texto").first().fill("Olá, {{solicitante}}! O técnico passa amanhã às 9 h. Código {{codigo}}.");
  await page.getByRole("button", { name: "Criar resposta" }).click();
  await expect(page.getByRole("status")).toHaveText("Resposta criada.");

  await page.goto(`/queue/${requestId!}`);
  await page.waitForLoadState("networkidle"); // the picker works after hydration
  await page.getByLabel("Inserir resposta pronta").selectOption({ label: title });
  await page.getByRole("button", { name: "Inserir" }).click();
  const body = page.getByLabel("Novo comentário");
  await expect(body).toHaveValue(`Olá, ${requesterFirstName}! O técnico passa amanhã às 9 h. Código ${requestId!.slice(0, 8).toUpperCase()}.`);
  // The attendant adjusts the text before sending; nothing was sent by the insertion.
  await body.press("End");
  await body.pressSequentially(` ${unique}`);
  await page.getByRole("button", { name: "Enviar comentário" }).click();
  await expect(page.locator("p.feedback").first()).toHaveText("Comentário enviado.");
  await signOut(page);

  await enterAs(page, "Solicitante");
  await page.goto(`/requests/${requestId!}`);
  await expect(page.locator("#conversa")).toContainText(`Olá, ${requesterFirstName}! O técnico passa amanhã às 9 h.`);
  await expect(page.locator("#conversa")).toContainText(unique);
  await expect(page.getByLabel("Inserir resposta pronta")).toHaveCount(0);
  await page.goto("/queue/responses");
  await expect(page).not.toHaveURL(/\/queue\/responses/);
});
