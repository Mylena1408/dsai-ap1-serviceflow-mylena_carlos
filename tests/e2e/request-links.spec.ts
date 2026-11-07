import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { ENTRANCE } from "./entrance";
import { seedDemoData } from "../../scripts/demo-data";

// SPEC 2026-11-07-operacao-e-automacao, section 8, part A (SF-176; CA-VNC-02 and 03 through the
// screens): the attendant links two requests of the demonstration requester, one as a duplicate of
// the other, and a third one of another requester; the requester sees only the link between their
// own requests; the attendant removes a link and the history keeps both events.

async function enterAs(page: Page, profile: "Solicitante" | "Atendente") {
  await page.goto("/");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration
  await page.getByRole("button", { name: `Entrar como ${profile}` }).click();
  await expect(page).not.toHaveURL(ENTRANCE);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(ENTRANCE);
}

const code = (id: string) => id.slice(0, 8).toUpperCase();

test("links between requests: duplicate, related, removal and who sees them", async ({ page }) => {
  test.setTimeout(180_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  let ids: { duplicate: string; original: string; foreign: string };
  try {
    await seedDemoData(database);
    const ana = await database.user.findUniqueOrThrow({ where: { email: "ana.souza@exemplo.test" } });
    const sector = await database.sector.findFirstOrThrow({ where: { name: "Central de Serviços" } });
    const [duplicate, original, foreign] = await database.request.findMany({
      where: { sectorId: sector.id, status: { in: ["OPEN", "IN_PROGRESS"] } },
      orderBy: { id: "asc" },
      take: 3,
    });
    const other = await database.user.findFirstOrThrow({ where: { role: "REQUESTER", id: { not: ana.id } } });
    await database.request.update({ where: { id: duplicate.id }, data: { requesterId: ana.id } });
    await database.request.update({ where: { id: original.id }, data: { requesterId: ana.id } });
    await database.request.update({ where: { id: foreign.id }, data: { requesterId: other.id } });
    await database.requestLink.deleteMany({ where: { OR: [duplicate, original, foreign].flatMap(({ id }) => [{ fromRequestId: id }, { toRequestId: id }]) } });
    ids = { duplicate: duplicate.id, original: original.id, foreign: foreign.id };
  } finally {
    await database.$disconnect();
  }

  // The attendant marks the duplicate and relates it to a request of another requester (CA-VNC-02).
  await enterAs(page, "Atendente");
  await page.goto(`/queue/${ids.duplicate}`);
  const form = page.getByRole("form", { name: "Vincular solicitação" });
  await form.locator('[name="code"]').fill(`#${code(ids.duplicate)}`);
  await form.getByRole("button", { name: "Vincular" }).click();
  await expect(page.locator("p.feedback-error")).toHaveText("Informe o código de 8 caracteres de outra solicitação, diferente desta.");

  await form.locator('[name="code"]').fill(code(ids.original).toLowerCase());
  await form.locator('[name="kind"]').selectOption("DUPLICATE_OF");
  await form.getByRole("button", { name: "Vincular" }).click();
  await expect(page.locator("p.feedback")).toHaveText("Solicitação vinculada.");
  await form.locator('[name="code"]').fill(code(ids.foreign));
  await form.getByRole("button", { name: "Vincular" }).click();
  await expect(page.locator("p.feedback")).toHaveText("Solicitação vinculada.");

  const block = page.getByRole("region", { name: "Vínculos" });
  await expect(block).toContainText(`Duplicada de #${code(ids.original)}`);
  await expect(block).toContainText(`Relacionada a #${code(ids.foreign)}`);
  await expect(page.locator("ol.history-list")).toContainText(`Vinculada como duplicada de #${code(ids.original)}`);

  // From the original, the same link reads "Original de", and the request opens from the block.
  await block.getByRole("link", { name: new RegExp(`Duplicada de #${code(ids.original)}`) }).click();
  await expect(page).toHaveURL(new RegExp(`/queue/${ids.original}$`));
  await expect(page.getByRole("region", { name: "Vínculos" })).toContainText(`Original de #${code(ids.duplicate)}`);
  await signOut(page);

  // The requester sees only the link between their own requests (CA-VNC-03).
  await enterAs(page, "Solicitante");
  await page.goto(`/requests/${ids.duplicate}`);
  const mine = page.getByRole("region", { name: "Vínculos" });
  await expect(mine).toContainText(`Duplicada de #${code(ids.original)}`);
  await expect(mine).not.toContainText(code(ids.foreign));
  await expect(mine.getByRole("button", { name: /Remover/ })).toHaveCount(0);
  await signOut(page);

  // The attendant removes the related link; the history keeps both events.
  await enterAs(page, "Atendente");
  await page.goto(`/queue/${ids.duplicate}`);
  await page.getByRole("button", { name: `Remover vínculo com #${code(ids.foreign)}` }).click();
  await expect(page.locator("p.feedback")).toHaveText("Vínculo removido.");
  await expect(page.getByRole("region", { name: "Vínculos" })).not.toContainText(code(ids.foreign));
  await expect(page.locator("ol.history-list")).toContainText(`Vínculo removido: relacionada a #${code(ids.foreign)}`);
});
