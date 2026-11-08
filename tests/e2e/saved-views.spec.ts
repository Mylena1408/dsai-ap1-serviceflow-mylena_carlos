import { expect, test, type Page } from "@playwright/test";
import { ENTRANCE } from "./entrance";

// SPEC 2026-11-07-operacao-e-automacao, section 8, part E (SF-191; CA-LOT-01 and 02 through the screens): the
// attendant saves a search of the queue, opens it with one click, renames and deletes it; the requester saves
// one in "Minhas solicitações" and the attendant's view is not there.

const unique = `e2e-visao-${Date.now()}`;

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

test("saved views: save, open, rename and delete, each person with their own", async ({ page }) => {
  test.setTimeout(180_000);
  const queueView = `${unique} Abertas`;

  await enterAs(page, "Atendente");
  await page.goto("/queue?status=OPEN&order=oldest");
  const views = page.getByRole("region", { name: "Minhas visões" });
  await views.getByLabel("Nome da visão").fill(queueView);
  await views.getByRole("button", { name: "Salvar esta busca" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Visão salva." })).toBeVisible();

  // Opened from the plain list, the view brings its criteria back.
  await page.goto("/queue");
  await views.getByRole("link", { name: queueView }).click();
  await expect(page).toHaveURL(/\/queue\?status=OPEN&order=oldest$/);
  await expect(page.getByRole("checkbox", { name: "Aberta" })).toBeChecked();
  await expect(views.getByRole("link", { name: queueView })).toHaveAttribute("aria-current", "page");

  // Rename, then delete.
  await views.getByText("Renomear ou apagar").click();
  const rename = views.getByRole("form", { name: `Renomear a visão ${queueView}` });
  await rename.getByLabel("Novo nome").fill(`${queueView} 2`);
  await rename.getByRole("button", { name: "Renomear" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Visão renomeada." })).toBeVisible();
  await expect(views.getByRole("link", { name: `${queueView} 2` })).toBeVisible();
  await signOut(page);

  // The requester has their own list, without the attendant's view.
  await enterAs(page, "Solicitante");
  await page.goto("/requests?status=COMPLETED");
  const mine = page.getByRole("region", { name: "Minhas visões" });
  await expect(mine.getByRole("link", { name: `${queueView} 2` })).toHaveCount(0);
  await mine.getByLabel("Nome da visão").fill(`${unique} Concluídas`);
  await mine.getByRole("button", { name: "Salvar esta busca" }).click();
  await expect(mine.getByRole("link", { name: `${unique} Concluídas` })).toHaveAttribute("href", "/requests?status=COMPLETED");
  await mine.getByText("Renomear ou apagar").click();
  await mine.getByRole("button", { name: "Apagar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Visão apagada." })).toBeVisible();
  await signOut(page);

  // The attendant deletes theirs too.
  await enterAs(page, "Atendente");
  await page.goto("/queue");
  await page.getByRole("region", { name: "Minhas visões" }).getByText("Renomear ou apagar").click();
  await page.getByRole("region", { name: "Minhas visões" }).getByRole("button", { name: "Apagar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Visão apagada." })).toBeVisible();
  await expect(page.getByText("Salve uma busca para voltar a ela com um clique.")).toBeVisible();
});
