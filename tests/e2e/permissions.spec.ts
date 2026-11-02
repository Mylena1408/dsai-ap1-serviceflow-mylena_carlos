import { expect, test, type Locator, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "../../scripts/demo-data";

// SPEC 2026-11-01-permissoes-configuraveis, section 8 (SF-091): the administrator grants "Gerir
// serviços do setor" to an attendant, who creates a service with a field; grants "Supervisionar a
// fila", and the attendant transfers a colleague's request; the revocation removes the page at once.

const unique = `e2e-permissao-${Date.now()}`;
const service = `${unique} Empréstimo de projetor`;
const colleague = { name: `${unique} Eva Lopes`, email: `${unique}@exemplo.test` };
const colleaguePassword = "E2E-only-colleague-password";

async function enterAs(page: Page, profile: "Administrador" | "Atendente") {
  await page.goto("/login");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration
  await page.getByRole("button", { name: `Entrar como ${profile}` }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login/);
}

function permissionsOf(page: Page, userName: string): Locator {
  return page
    .locator("ul.entity-list > li")
    .filter({ hasText: userName })
    .getByRole("region", { name: "Permissões adicionais" });
}

async function setPermission(page: Page, userName: string, permission: string, button: "Conceder" | "Revogar") {
  await page.goto("/admin?section=users");
  const row = () => permissionsOf(page, userName).locator("li.requirement-item").filter({ hasText: permission });
  await row().getByRole("button", { name: button }).click();
  await expect(row()).toContainText(
    button === "Conceder" ? "Concedida" : "Não concedida",
  );
}

test("permissions: sector services, queue supervision and revocation", async ({ browser, page }) => {
  test.setTimeout(300_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  try {
    await seedDemoData(database);

    // The demonstration attendant exists from its first sign-in and has no extra page (CA-PER-01).
    await enterAs(page, "Atendente");
    await expect(page.getByRole("link", { name: "Serviços do setor" })).toHaveCount(0);
    await signOut(page);

    // Administrator creates a colleague and grants two permissions (CA-PER-02, 03, 09).
    await enterAs(page, "Administrador");
    await page.goto("/admin?section=users");
    const userForm = page.getByRole("region", { name: "Usuários" }).locator("form").first();
    await userForm.locator('[name="name"]').fill(colleague.name);
    await userForm.locator('[name="email"]').fill(colleague.email);
    await userForm.locator('[name="password"]').fill(colleaguePassword);
    await userForm.locator('[name="role"]').selectOption("ATTENDANT");
    await userForm.locator('[name="sectorId"]').selectOption({ label: "Setor de demonstração" });
    await userForm.getByRole("button", { name: "Criar usuário" }).click();
    await expect(userForm.getByRole("status")).toHaveText("Registro criado.");

    await setPermission(page, "Atendente (demonstração)", "Gerir serviços do setor", "Conceder");
    await setPermission(page, "Atendente (demonstração)", "Supervisionar a fila do setor", "Conceder");
    await expect(permissionsOf(page, "Atendente (demonstração)")).toContainText(
      "Gerir serviços do setor: concedida por Administrador (demonstração)",
    );
    await signOut(page);

    // The attendant creates a service of the sector with a field (CA-PER-05).
    await enterAs(page, "Atendente");
    await page.getByRole("link", { name: "Serviços do setor" }).click();
    await expect(page.getByRole("heading", { name: "Serviços do setor", level: 1 })).toBeVisible();
    const serviceForm = page.getByRole("region", { name: "Serviços" }).locator("form").first();
    await serviceForm.locator('[name="name"]').fill(service);
    await serviceForm.locator('[name="description"]').fill("Serviço criado pelo atendente com permissão.");
    await serviceForm.locator('[name="categoryId"]').selectOption({ label: "TI" });
    await serviceForm.locator('[name="sectorId"]').selectOption({ label: "Setor de demonstração" });
    await serviceForm.getByRole("button", { name: "Criar serviço" }).click();
    await expect(serviceForm.getByRole("status")).toHaveText("Registro criado.");
    const fields = page.locator("ul.entity-list > li").filter({ hasText: service }).getByRole("region", { name: "Campos do formulário" });
    await fields.locator('form.create-form [name="label"]').fill("Sala de uso");
    await fields.getByRole("button", { name: "Adicionar campo" }).click();
    await expect(fields.locator("ol.requirement-list")).toContainText("Sala de uso");

    // The attendant transfers a request held by a colleague (CA-PER-07, 08).
    const diego = await database.user.findUniqueOrThrow({ where: { email: "diego.rocha@exemplo.test" } });
    const open = await database.request.findFirstOrThrow({ where: { status: "OPEN", sectorId: diego.sectorId! } });
    await database.request.update({ where: { id: open.id }, data: { assigneeId: diego.id } });
    await page.goto(`/queue/${open.id}`);
    await expect(page.getByText("Você supervisiona a fila do setor: pode liberar ou transferir.")).toBeVisible();
    const targets = page.locator("#transfer-assignee option");
    await expect(targets).not.toContainText(["Diego Rocha"]);
    await page.locator("#transfer-assignee").selectOption({ label: colleague.name });
    await page.getByRole("button", { name: "Transferir" }).click();
    await expect(page.locator("p.feedback")).toHaveText("Solicitação transferida.");
    await expect(page.locator("ol.history-list")).toContainText(`Transferida de Diego Rocha para ${colleague.name}`);

    // The revocation removes the page at once, while the attendant stays signed in (CA-PER-04).
    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    await enterAs(admin, "Administrador");
    await setPermission(admin, "Atendente (demonstração)", "Gerir serviços do setor", "Revogar");
    await expect(permissionsOf(admin, "Atendente (demonstração)")).toContainText(
      "Gerir serviços do setor: revogada por Administrador (demonstração)",
    );
    await adminContext.close();
    await page.goto("/sector-services");
    await expect(page).toHaveURL(/\/queue$/);
    await expect(page.getByRole("link", { name: "Serviços do setor" })).toHaveCount(0);
  } finally {
    await database.$disconnect();
  }
});
