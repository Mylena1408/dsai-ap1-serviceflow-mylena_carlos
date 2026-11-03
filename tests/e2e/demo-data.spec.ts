import { expect, test } from "@playwright/test";
import { ENTRANCE } from "./entrance";
import { PrismaClient } from "@prisma/client";
import { DEMO_CATALOG, seedDemoData } from "../../scripts/demo-data";

// SPEC 2026-09-30, sections 22.6, 22.7 and 25 (CA-DEMO-07, CA-DEMO-08 and CA-FIC-03).
test("demonstration data is visible to each profile", async ({ page }) => {
  test.setTimeout(120_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  let declaration: { id: string };
  try {
    await seedDemoData(database);
    declaration = await database.request.findFirstOrThrow({
      where: { description: "Declaração para apresentar no banco até sexta-feira." },
      select: { id: true },
    });
  } finally {
    await database.$disconnect();
  }

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Entrar como Solicitante" }).click();
  await expect(page).toHaveURL(/\/catalog/);
  for (const group of DEMO_CATALOG) {
    const category = page.getByRole("region", { name: group.category, exact: true });
    await expect(category).toBeVisible();
    for (const service of group.services) {
      await expect(category.getByRole("link", { name: service.name })).toBeVisible();
    }
  }

  await page.getByRole("link", { name: "Minhas solicitações" }).first().click();
  // The requester list shows the service and status; descriptions appear on the detail page.
  for (const service of ["Solicitação de equipamento", "Declaração de vínculo", "Reparo elétrico"]) {
    await expect(page.getByRole("link", { name: service })).toBeVisible();
  }
  for (const status of ["Aberta", "Em atendimento", "Concluída", "Cancelada"]) {
    await expect(page.locator(".status-pill", { hasText: status }).first()).toBeVisible();
  }

  const description = `Pedido aberto no E2E ${Date.now()}`;
  await page.goto("/catalog");
  await page.getByRole("link", { name: "Reparo de mobiliário" }).first().click();
  await page.getByLabel("Descreva o que você precisa").fill(description);
  await page.getByRole("button", { name: "Enviar solicitação" }).click();
  await expect(page.getByRole("status")).toHaveText("Sua solicitação foi aberta.");
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(ENTRANCE);
  // "Sair" may land on another host name of the test server (localhost); the session cookie
  // belongs to the host, so the next sign-in starts from the base URL used by page.goto.
  await page.goto("/");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration

  await page.getByRole("button", { name: "Entrar como Atendente" }).click();
  await expect(page).toHaveURL(/\/queue/);
  await expect(page.getByText("Fui bloqueado no sistema de compras após três tentativas.")).toBeVisible();
  // The queue lists the oldest first, 20 per page; requests left by other E2E files can push the new
  // one to page 2, so it is looked up by its text (SF-137).
  await page.goto(`/queue?q=${encodeURIComponent(description)}`);
  await expect(page.getByText(description)).toBeVisible();
  // Section 25.3: Diego is the assignee of Ana's declaration and sees his internal note.
  await page.goto(`/queue/${declaration.id}`);
  await expect(page.getByText("Conferir a data de admissão no sistema de RH antes de emitir.")).toBeVisible();
  await expect(page.getByText("Já estou preparando a declaração; aviso assim que estiver assinada.")).toBeVisible();
  await expect(page.getByText("Diego Rocha (você)")).toBeVisible();
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(ENTRANCE);
  await page.waitForLoadState("networkidle"); // buttons only work after hydration

  // Paulo has an approval waiting for him (section 25.3).
  await page.getByRole("button", { name: "Entrar como Gestor" }).click();
  await expect(page).toHaveURL(/\/approvals$/);
  await expect(page.getByText("Aguardando aprovação").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Solicitação de equipamento" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(ENTRANCE);
  await page.waitForLoadState("networkidle"); // buttons only work after hydration

  await page.getByRole("button", { name: "Entrar como Administrador" }).click();
  await expect(page).toHaveURL(/\/admin/);
  await page
    .getByRole("navigation", { name: "Seções administrativas" })
    .getByRole("link", { name: "Usuários", exact: true })
    .click();
  await expect(page.getByText("ana.souza@exemplo.test")).toBeVisible();
  await page
    .getByRole("navigation", { name: "Seções administrativas" })
    .getByRole("link", { name: "Serviços", exact: true })
    .click();
  await expect(page.getByText("Comprovante de residência")).toBeVisible();
});
