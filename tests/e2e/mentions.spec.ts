import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { ENTRANCE } from "./entrance";
import { seedDemoData } from "../../scripts/demo-data";
import { DEMO_ACCOUNTS } from "../../src/modules/auth/domain/demo-accounts";

// SPEC 2026-11-08-atendimento-dia-a-dia, section 11, part E (SF-216; CA-MEN-01 and 02 through the screens): the attendant
// writes an internal note mentioning a colleague of the sector; the note shows whom it mentions; a mention in a public
// comment is refused; the requester never sees the note nor the mention.

const unique = `e2e-men-${Date.now()}`;
const serviceName = `${unique} Serviço`;
const colleagueName = `Colega ${unique.slice(-6)}`;

async function enterAs(page: Page, profile: "Atendente" | "Solicitante") {
  await page.goto("/");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration
  await page.getByRole("button", { name: `Entrar como ${profile}` }).click();
  await expect(page).not.toHaveURL(ENTRANCE);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(ENTRANCE);
}

// Later tests of the run do not meet the service nor the extra attendant (the queue's distribution counts active
// attendants).
test.afterEach(async () => {
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  try {
    await database.service.updateMany({ where: { name: serviceName }, data: { isActive: false } });
    await database.user.updateMany({ where: { name: colleagueName }, data: { isActive: false } });
  } finally {
    await database.$disconnect();
  }
});

test("mentions: an internal note mentions a colleague of the sector, never seen by the requester", async ({ page }) => {
  test.setTimeout(240_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  let requestId = "";
  let colleagueId = "";
  try {
    await seedDemoData(database);
    const sector = await database.sector.findFirstOrThrow({ where: { name: "Central de Serviços" } });
    const category = await database.category.findFirstOrThrow({ where: { isActive: true } });
    const service = await database.service.create({ data: { name: serviceName, description: "Serviço do teste.", categoryId: category.id, sectorId: sector.id } });
    const requester = await database.user.findUniqueOrThrow({ where: { email: "ana.souza@exemplo.test" } });
    // The demo attendant itself, who enters by the button: other tests of the run add attendants to the same sector.
    const template = await database.user.findUniqueOrThrow({ where: { email: DEMO_ACCOUNTS.ATTENDANT.email } });
    colleagueId = (
      await database.user.create({
        data: { name: colleagueName, email: `${unique}@exemplo.test`, role: "ATTENDANT", sectorId: sector.id, passwordHash: template.passwordHash },
      })
    ).id;
    const request = await database.request.create({
      data: {
        requesterId: requester.id,
        serviceId: service.id,
        sectorId: sector.id,
        serviceNameSnapshot: service.name,
        serviceDescriptionSnapshot: service.description,
        categoryIdSnapshot: category.id,
        categoryNameSnapshot: category.name,
        sectorNameSnapshot: sector.name,
        description: "Pedido com menção.",
        status: "OPEN",
      },
    });
    requestId = request.id;
    // The colleague mentions the demo attendant in a note, as the use case would (13.4 item 1).
    const note = await database.requestComment.create({
      data: { requestId: request.id, authorId: colleagueId, body: "Nota do colega com menção.", isInternal: true },
    });
    await database.commentMention.create({ data: { commentId: note.id, userId: template.id, createdAt: new Date() } });
  } finally {
    await database.$disconnect();
  }

  await enterAs(page, "Atendente");
  // "Minhas menções": the new mention, opened from the list, leads to the conversation and becomes seen.
  await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: /^Minhas menções/ }).click();
  const mentions = page.getByRole("list", { name: "Menções recebidas" });
  await expect(mentions).toContainText(serviceName);
  await expect(mentions).toContainText("Nova");
  await mentions.getByRole("button", { name: `Abrir a menção em ${serviceName}` }).click();
  await expect(page).toHaveURL(new RegExp(`/queue/${requestId}`));
  await expect(page.getByText("Nota do colega com menção.")).toBeVisible();
  await page.goto("/queue/mentions");
  await expect(page.getByRole("list", { name: "Menções recebidas" })).toContainText("vista");
  await page.goto(`/queue/${requestId}`);
  const conversation = page.getByRole("region", { name: "Conversa" });

  // A mention in a public comment is refused (CA-MEN-02).
  await conversation.locator('[name="body"]').fill("Comentário público com menção.");
  await conversation.getByRole("checkbox", { name: colleagueName }).check();
  await conversation.getByRole("button", { name: "Enviar comentário" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Menções só em nota interna" })).toBeVisible();

  // An internal note mentions the colleague.
  await conversation.locator('[name="body"]').fill("Pode conferir o equipamento?");
  await conversation.getByRole("checkbox", { name: "Nota interna (o solicitante não vê)" }).check();
  await conversation.getByRole("checkbox", { name: colleagueName }).check();
  await conversation.getByRole("button", { name: "Enviar comentário" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Comentário enviado." })).toBeVisible();
  await expect(conversation).toContainText(`Menciona: ${colleagueName}`);
  await signOut(page);

  const check = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  try {
    expect(await check.commentMention.count({ where: { userId: colleagueId } })).toBe(1);
  } finally {
    await check.$disconnect();
  }

  // The requester sees neither the note nor the mention.
  await enterAs(page, "Solicitante");
  await page.goto(`/requests/${requestId}`);
  await expect(page.getByText("Pedido com menção.")).toBeVisible();
  await expect(page.getByText("Pode conferir o equipamento?")).toHaveCount(0);
  await expect(page.getByText(colleagueName)).toHaveCount(0);
});
