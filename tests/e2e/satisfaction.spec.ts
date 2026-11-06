import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "../../scripts/demo-data";
import { ENTRANCE } from "./entrance";

// SPEC 2026-11-06-pesquisa-satisfacao, section 7 (SF-151): the requester rates a completed request,
// cannot rate it twice, the attendant of the sector reads the rating and the manager sees it in the
// analytics, without the comment.

const comment = `Muito bom ${Date.now()}`;

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

test("the requester rates a completed request and the team sees it", async ({ page }) => {
  test.setTimeout(180_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  let requestId: string;
  try {
    await seedDemoData(database);
    // A previous run may have rated it already: start from no rating.
    const request = await database.request.findFirstOrThrow({ where: { description: "A tomada ao lado da minha mesa não está funcionando." } });
    await database.requestSatisfactionEvent.deleteMany({ where: { requestId: request.id } });
    await database.requestSatisfaction.deleteMany({ where: { requestId: request.id } });
    requestId = request.id;
  } finally {
    await database.$disconnect();
  }

  await enterAs(page, "Solicitante");
  await page.goto(`/requests/${requestId!}`);
  const survey = page.getByRole("region", { name: "Como foi o atendimento?" });
  await expect(survey).toBeVisible();
  // The browser asks for a rating before sending.
  await survey.getByRole("button", { name: "Enviar avaliação" }).click();
  await expect(page).toHaveURL(new RegExp(`/requests/${requestId!}$`));

  await survey.getByLabel("5 · Muito satisfeito").check();
  await survey.getByLabel("Quer contar mais? (opcional)").fill(comment);
  await survey.getByRole("button", { name: "Enviar avaliação" }).click();
  await expect(page.getByRole("status")).toHaveText("Obrigado pela avaliação.");
  await expect(survey).toContainText("5 de 5 · Muito satisfeito");
  await expect(survey).toContainText(comment);
  await expect(survey.getByRole("button", { name: "Enviar avaliação" })).toHaveCount(0);
  await signOut(page);

  // The attendant of the sector reads the rating on the request.
  await enterAs(page, "Atendente");
  await page.goto(`/queue/${requestId!}`);
  const team = page.getByRole("region", { name: "Avaliação do solicitante" });
  await expect(team).toContainText("5 de 5");
  await expect(team).toContainText(comment);
  await signOut(page);

  // The manager sees the numbers in the analytics, never the comment.
  await enterAs(page, "Gestor");
  await page.goto("/approvals/analytics");
  const satisfaction = page.locator("section[aria-labelledby=analytics-satisfaction]");
  await expect(satisfaction).toContainText("Nota média");
  await expect(satisfaction).toContainText("5 de 5");
  await expect(page.locator("body")).not.toContainText(comment);
});
