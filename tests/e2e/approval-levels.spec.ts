import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { ENTRANCE } from "./entrance";
import { seedDemoData } from "../../scripts/demo-data";

// SPEC 2026-11-06-aprofundamento-configurabilidade, section 8, part B (SF-167; CA-APM-02 to 07 through
// the screens): the administrator configures two levels, a condition and a deadline; the requester
// opens; the demonstration manager approves the first level and, replacing the absent manager of
// the second level's sector, approves the second one too. The history names the substitution.

const unique = `e2e-niveis-${Date.now()}`;
const service = `${unique} Compra de equipamento`;
const finance = `${unique} Financeiro`;

async function enterAs(page: Page, profile: "Administrador" | "Solicitante" | "Gestor") {
  await page.goto("/");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration
  await page.getByRole("button", { name: `Entrar como ${profile}` }).click();
  await expect(page).not.toHaveURL(ENTRANCE);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(ENTRANCE);
}

test("approval levels: configuration, condition, deadline and a substitute deciding the second level", async ({ page }) => {
  test.setTimeout(240_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  try {
    await seedDemoData(database);
    const sector = await database.sector.create({ data: { name: finance } });
    const fred = await database.user.create({
      data: { name: `${unique} Fred`, email: `${unique}@example.test`, role: "MANAGER", sectorId: sector.id, passwordHash: "!e2e-unusable" },
    });
    const paulo = await database.user.findUniqueOrThrow({ where: { email: "paulo.ribeiro@exemplo.test" } });
    const [{ today }] = await database.$queryRaw<Array<{ today: string }>>`SELECT to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS "today"`;
    // Fred is away today; the demonstration manager replaces him.
    await database.managerAbsence.create({
      data: { managerId: fred.id, substituteId: paulo.id, createdById: fred.id, startsOn: new Date(`${today}T00:00:00Z`), endsOn: new Date(`${today}T00:00:00Z`) },
    });
  } finally {
    await database.$disconnect();
  }

  // The administrator creates the service with approval and a choice field (CA-APM-02).
  await enterAs(page, "Administrador");
  await page.getByRole("navigation", { name: "Seções administrativas" }).getByRole("link", { name: "Serviços", exact: true }).click();
  const create = page.getByRole("region", { name: "Serviços" }).locator("form").first();
  await create.locator('[name="name"]').fill(service);
  await create.locator('[name="description"]').fill("Compra com dois níveis de aprovação.");
  await create.locator('[name="categoryId"]').selectOption({ label: "TI" });
  await create.locator('[name="sectorId"]').selectOption({ label: "Central de Serviços" });
  await create.locator('[name="requiresApproval"]').check();
  await create.getByRole("button", { name: "Criar serviço" }).click();
  await expect(create.getByRole("status")).toHaveText("Registro criado.");

  const card = page.locator("ul.entity-list > li").filter({ hasText: service });
  const fieldForm = card.getByRole("region", { name: "Campos do formulário" }).locator("form.create-form");
  await fieldForm.locator('[name="label"]').fill("Faixa de valor");
  await fieldForm.locator('[name="type"]').selectOption("SELECT");
  await fieldForm.locator('[name="isRequired"]').selectOption("true");
  await fieldForm.locator('[name="options"]').fill("Até R$ 1.000\nAcima de R$ 1.000");
  await fieldForm.getByRole("button", { name: "Adicionar campo" }).click();
  await expect(card.getByRole("region", { name: "Campos do formulário" })).toContainText("Faixa de valor");

  // Two levels, the condition and two days per level.
  await page.reload();
  const approval = page.locator("ul.entity-list > li").filter({ hasText: service }).getByRole("region", { name: "Aprovação" });
  await approval.locator('[name="level1"]').selectOption({ label: "Central de Serviços" });
  await approval.locator('[name="level2"]').selectOption({ label: finance });
  await approval.locator('[name="condition"]').selectOption({ label: "Faixa de valor = Acima de R$ 1.000" });
  await approval.locator('[name="deadlineDays"]').fill("2");
  await approval.getByRole("button", { name: "Salvar aprovação" }).click();
  await expect(approval.getByRole("status")).toHaveText("Alterações salvas.");
  await page.reload();
  await expect(
    page.locator("ul.entity-list > li").filter({ hasText: service }).getByRole("region", { name: "Aprovação" }),
  ).toContainText(`1. Central de Serviços → 2. ${finance}; 2 dias para cada nível`);

  // The administrator sees the absence in "Ausências".
  await page.goto("/admin?section=absences");
  await expect(page.getByRole("table", { name: "Ausências registradas" })).toContainText(`${unique} Fred`);
  await signOut(page);

  // The requester opens two requests: only the one that meets the condition needs approval (CA-APM-06).
  await enterAs(page, "Solicitante");
  for (const range of ["Até R$ 1.000", "Acima de R$ 1.000"]) {
    await page.goto("/catalog");
    await page.getByRole("link", { name: service }).click();
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Descreva o que você precisa").fill(`${unique} ${range}`);
    await page.getByLabel("Faixa de valor (obrigatório)").selectOption(range);
    await page.getByRole("button", { name: "Enviar solicitação" }).click();
    await expect(page.getByRole("status")).toHaveText("Sua solicitação foi aberta.");
  }
  const levels = page.getByRole("region", { name: "Níveis de aprovação" });
  await expect(levels).toContainText("Nível 1 de 2: Central de Serviços — Aguardando decisão");
  await expect(levels).toContainText("Prazo para decidir:");
  await expect(levels).toContainText(`Nível 2 de 2: ${finance} — Aguardando o nível anterior`);
  const requestUrl = new URL(page.url());
  const requestId = requestUrl.pathname.split("/").at(-1)!;
  await signOut(page);

  // The demonstration manager approves level 1, then level 2 replacing Fred (CA-APM-03 and 04).
  await enterAs(page, "Gestor");
  await expect(page.getByRole("main")).toContainText("Nível 1 de 2");
  await page.goto(`/approvals/${requestId}`);
  await page.getByRole("button", { name: "Aprovar" }).click();
  await expect(page.getByRole("status")).toHaveText("Solicitação aprovada.");
  await expect(page.getByRole("region", { name: "Níveis de aprovação" })).toContainText(
    `Nível 2 de 2: ${finance} — Aguardando decisão`,
  );
  await page.getByRole("button", { name: "Aprovar" }).click();
  await expect(page.getByRole("status")).toHaveText("Solicitação aprovada.");
  const finished = page.getByRole("region", { name: "Níveis de aprovação" });
  await expect(finished).toContainText("Nível 1 de 2: Central de Serviços — Aprovado por Paulo Ribeiro");
  await expect(finished).toContainText(`Nível 2 de 2: ${finance} — Aprovado por Paulo Ribeiro, substituindo ${unique} Fred`);
  await expect(page.getByRole("main")).toContainText(`Aprovada no nível 2 de 2 por Paulo Ribeiro, substituindo ${unique} Fred`);
});
