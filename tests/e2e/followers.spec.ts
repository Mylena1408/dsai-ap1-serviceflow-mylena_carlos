import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { ENTRANCE } from "./entrance";
import { seedDemoData } from "../../scripts/demo-data";

// SPEC 2026-11-08-atendimento-dia-a-dia, section 11, part D (SF-214; CA-SEG-01 to 03 through the screens): the requester
// adds a colleague by e-mail; the attendant follows; the manager sees who follows; a colleague reads a request they
// follow, without the team's notes, and stops following.

const unique = `e2e-seg-${Date.now()}`;
const serviceName = `${unique} Serviço`;

async function enterAs(page: Page, profile: "Gestor" | "Atendente" | "Solicitante") {
  await page.goto("/");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration
  await page.getByRole("button", { name: `Entrar como ${profile}` }).click();
  await expect(page).not.toHaveURL(ENTRANCE);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(ENTRANCE);
}

// Later tests of the run do not meet the service among the sector's active ones.
test.afterEach(async () => {
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  try {
    await database.service.updateMany({ where: { name: serviceName }, data: { isActive: false } });
  } finally {
    await database.$disconnect();
  }
});

test("followers: a colleague added by e-mail, an attendant who follows, and a colleague's reading", async ({ page }) => {
  test.setTimeout(240_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  let ownId = "";
  let followedId = "";
  try {
    await seedDemoData(database);
    const sector = await database.sector.findFirstOrThrow({ where: { name: "Central de Serviços" } });
    const category = await database.category.findFirstOrThrow({ where: { isActive: true } });
    const service = await database.service.create({ data: { name: serviceName, description: "Serviço do teste.", categoryId: category.id, sectorId: sector.id } });
    const ana = await database.user.findUniqueOrThrow({ where: { email: "ana.souza@exemplo.test" } });
    const bruno = await database.user.findUniqueOrThrow({ where: { email: "bruno.lima@exemplo.test" } });
    const attendant = await database.user.findFirstOrThrow({ where: { role: "ATTENDANT", sectorId: sector.id, isActive: true } });
    const open = (requesterId: string, description: string) =>
      database.request.create({
        data: {
          requesterId,
          serviceId: service.id,
          sectorId: sector.id,
          serviceNameSnapshot: service.name,
          serviceDescriptionSnapshot: service.description,
          categoryIdSnapshot: category.id,
          categoryNameSnapshot: category.name,
          sectorNameSnapshot: sector.name,
          description,
          status: "OPEN",
        },
      });
    ownId = (await open(ana.id, "Pedido da Ana.")).id;
    const followed = await open(bruno.id, "Pedido do Bruno.");
    followedId = followed.id;
    // Bruno has no sign-in button: his inclusion of Ana is written here, as the use case would.
    await database.requestFollower.create({ data: { requestId: followed.id, userId: ana.id, addedById: bruno.id, createdAt: new Date() } });
    await database.requestComment.createMany({
      data: [
        { requestId: followed.id, authorId: attendant.id, body: "Comentário público do atendimento." },
        { requestId: followed.id, authorId: attendant.id, body: "Nota interna da equipe.", isInternal: true },
      ],
    });
  } finally {
    await database.$disconnect();
  }

  // The requester adds a colleague by e-mail (CA-SEG-02).
  await enterAs(page, "Solicitante");
  await page.goto(`/requests/${ownId}`);
  const followers = page.getByRole("region", { name: "Acompanham" });
  await expect(followers).toContainText("Ninguém acompanha esta solicitação");
  const add = followers.getByRole("form", { name: "Incluir colega" });
  await add.locator('[name="email"]').fill("ninguem@exemplo.test");
  await add.getByRole("button", { name: "Incluir colega" }).click();
  await expect(followers.getByRole("alert")).toContainText("confira o e-mail");
  await followers.getByRole("form", { name: "Incluir colega" }).locator('[name="email"]').fill("bruno.lima@exemplo.test");
  await followers.getByRole("form", { name: "Incluir colega" }).getByRole("button", { name: "Incluir colega" }).click();
  await expect(followers.getByRole("status")).toContainText("Colega incluído.");
  await expect(followers.getByRole("list", { name: "Quem acompanha" })).toContainText("Bruno Lima");
  await expect(page.locator("ol.history-list")).toContainText("Bruno Lima passou a acompanhar");

  // The colleague's reading, from "Que eu acompanho" (CA-SEG-03).
  await page.goto("/requests");
  await page.getByRole("link", { name: "Que eu acompanho" }).click();
  await expect(page.getByRole("heading", { name: "Que eu acompanho" })).toBeVisible();
  await page.getByRole("list", { name: "Solicitações que eu acompanho" }).getByRole("link", { name: serviceName }).click();
  await expect(page).toHaveURL(new RegExp(`/requests/following/${followedId}$`));
  await expect(page.getByText("Pedido do Bruno.")).toBeVisible();
  await expect(page.getByText("Comentário público do atendimento.")).toBeVisible();
  await expect(page.getByText("Nota interna da equipe.")).toHaveCount(0);
  // The requester's own page of that request does not open for the colleague.
  const own = await page.goto(`/requests/${followedId}`);
  expect(own?.status()).toBe(404);
  await page.goto(`/requests/following/${followedId}`);
  await page.getByRole("button", { name: "Deixar de acompanhar" }).click();
  await expect(page).toHaveURL(/\/requests\/following\?follow=follow-stopped/);
  await expect(page.getByText("Você não acompanha nenhuma solicitação de colega.")).toBeVisible();
  await signOut(page);

  // The attendant follows the requester's request; the manager sees who follows.
  await enterAs(page, "Atendente");
  await page.goto(`/queue/${ownId}`);
  await page.getByRole("region", { name: "Acompanham" }).getByRole("button", { name: "Acompanhar" }).click();
  await expect(page.getByRole("region", { name: "Acompanham" }).getByRole("status")).toContainText("Você passou a acompanhar");
  // "Que eu acompanho" in the queue (13.3 item 1).
  await page.goto(`/queue?q=${encodeURIComponent(unique)}`);
  await page.getByRole("checkbox", { name: "Que eu acompanho" }).check();
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page).toHaveURL(/following=1/);
  await expect(page.locator(".content-list")).toContainText(serviceName);
  await expect(page.locator(".content-list li")).toHaveCount(1);
  await signOut(page);
});
