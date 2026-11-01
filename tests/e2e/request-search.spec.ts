import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "../../scripts/demo-data";
import { DEMO_ACCOUNTS } from "../../src/modules/auth/domain/demo-accounts";
import { buildRequestSnapshot } from "../../src/modules/requests/domain/snapshot";

// SPEC 2026-10-31-busca-filtros-paginacao, section 9 (SF-060). 22 synthetic requests are
// written straight to the E2E database so the lists have more than one page.

const unique = `e2ebusca${Date.now()}`;
const TOTAL = 22;

async function enterAs(page: Page, profile: "Solicitante" | "Atendente") {
  await page.goto("/login");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration
  await page.getByRole("button", { name: `Entrar como ${profile}` }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login/);
}

async function seedSearchData() {
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });

  try {
    await seedDemoData(database);
    // seedDemoData creates the demonstration accounts, so this spec also runs alone.
    const requester = await database.user.findUniqueOrThrow({ where: { email: DEMO_ACCOUNTS.REQUESTER.email } });
    const attendant = await database.user.findUniqueOrThrow({ where: { email: DEMO_ACCOUNTS.ATTENDANT.email } });
    const service = await database.service.findFirstOrThrow({
      where: { name: "Reparo de mobiliário" },
      include: { category: true, sector: true },
    });

    for (let index = 0; index < TOTAL; index += 1) {
      const openedAt = new Date(Date.UTC(2026, 9, 1, 12, index));
      const inProgress = index >= 20;
      await database.request.create({
        data: {
          ...buildRequestSnapshot(requester.id, service),
          description: `${unique} item ${String(index).padStart(2, "0")}`,
          status: inProgress ? "IN_PROGRESS" : "OPEN",
          assigneeId: index === 5 ? attendant.id : null,
          createdAt: openedAt,
          updatedAt: openedAt,
          events: {
            create: [
              { actorId: requester.id, fromStatus: null, toStatus: "OPEN", occurredAt: openedAt },
              ...(inProgress
                ? [{ actorId: attendant.id, fromStatus: "OPEN" as const, toStatus: "IN_PROGRESS" as const, occurredAt: openedAt }]
                : []),
            ],
          },
        },
      });
    }
  } finally {
    await database.$disconnect();
  }
}

const items = (page: Page) => page.locator("ul.content-list > li");
const summary = (page: Page) => page.getByRole("navigation", { name: "Páginas da lista" }).locator("p");

test("search, filters and pages keep the criteria in the URL", async ({ page }) => {
  test.setTimeout(180_000);
  await seedSearchData();

  // Attendant searches, pages forward and reloads (CA-BUS-02, 08, 09).
  await enterAs(page, "Atendente");
  await page.getByLabel("Buscar").fill(unique.toUpperCase());
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page).toHaveURL(new RegExp(`q=${unique.toUpperCase()}`));
  await expect(summary(page)).toHaveText(`Página 1 de 2 — ${TOTAL} solicitações`);
  await expect(items(page)).toHaveCount(20);
  await expect(items(page).first()).toContainText(`${unique} item 00`);

  await page.getByRole("link", { name: "Próxima" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(summary(page)).toHaveText(`Página 2 de 2 — ${TOTAL} solicitações`);
  await expect(items(page)).toHaveCount(2);
  await page.reload();
  await expect(page.getByLabel("Buscar")).toHaveValue(unique.toUpperCase());
  await expect(items(page)).toHaveCount(2);

  // Changing a criterion goes back to page 1; "Atribuídas a mim" uses the assignee (CA-BUS-05).
  await page.getByLabel("Responsável").selectOption("mine");
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page).not.toHaveURL(/page=/);
  await expect(items(page)).toHaveCount(1);
  await expect(items(page).first()).toContainText(`${unique} item 05`);
  await expect(items(page).first()).toContainText("Responsável: você");

  // Newest first reverses the order (CA-BUS-07).
  await page.getByLabel("Responsável").selectOption("all");
  await page.getByLabel("Ordem").selectOption("newest");
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(items(page).first()).toContainText(`${unique} item 21`);

  // Invalid criteria show a fixed message and no list (CA-BUS-03).
  await page.getByLabel("Buscar").fill("x");
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page.locator("p.feedback-error")).toContainText("Critérios de busca inválidos.");
  await expect(items(page)).toHaveCount(0);
  await signOut(page);

  // Requester filters their own list by status and period (CA-BUS-01, 04, 06).
  await enterAs(page, "Solicitante");
  await page.goto("/requests");
  await page.getByLabel("Buscar").fill(unique);
  await page.getByLabel("Em atendimento").check();
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(items(page)).toHaveCount(2);
  await expect(summary(page)).toHaveText("Página 1 de 1 — 2 solicitações");
  await expect(page.getByLabel("Responsável")).toHaveCount(0);

  await page.getByLabel("Em atendimento").uncheck();
  await page.getByLabel("Aberta de").fill("2026-10-02");
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page.getByText("Nenhuma solicitação encontrada com esses critérios.")).toBeVisible();

  await page.getByRole("link", { name: "Limpar" }).click();
  await expect(page).toHaveURL(/\/requests$/);
  await expect(page.getByLabel("Buscar")).toHaveValue("");
});
