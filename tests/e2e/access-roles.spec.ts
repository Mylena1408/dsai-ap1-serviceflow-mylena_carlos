import { expect, test, type Locator, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { ENTRANCE } from "./entrance";
import { seedDemoData } from "../../scripts/demo-data";

// SPEC 2026-11-06-aprofundamento-configurabilidade, section 8, part D (SF-172; CA-PAP-02 to 05
// through the screens): the administrator creates a role, assigns it to the demonstration attendant
// with an end, the attendant gets the sector page at once; deactivating the role or the end passing
// takes it away without a new sign-in; the audit trail and the user's history record it all.

const unique = `e2e-papeis-${Date.now()}`;
const roleName = `${unique} Catálogo`;

async function enterAs(page: Page, profile: "Administrador" | "Atendente") {
  await page.goto("/");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration
  await page.getByRole("button", { name: `Entrar como ${profile}` }).click();
  await expect(page).not.toHaveURL(ENTRANCE);
}

function rolesOf(page: Page, userName: string): Locator {
  return page.locator("ul.entity-list > li").filter({ hasText: userName }).getByRole("region", { name: "Papéis" });
}

function roleCard(page: Page): Locator {
  return page.getByRole("region", { name: "Papéis" }).locator("ul.entity-list > li").filter({ hasText: roleName });
}

function brazilian(day: string): string {
  const [year, month, date] = day.split("-");
  return `${date}/${month}/${year}`;
}

test("access roles: create, assign with an end, deactivate and expire", async ({ browser, page }) => {
  test.setTimeout(300_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  try {
    await seedDemoData(database);
    const diego = await database.user.findUniqueOrThrow({ where: { email: "diego.rocha@exemplo.test" } });
    // Diego starts without extra permissions, whatever other tests left.
    await database.userPermission.deleteMany({ where: { userId: diego.id } });
    await database.userAccessRole.deleteMany({ where: { userId: diego.id } });
    const calendar = await database.businessCalendar.findUnique({ where: { id: 1 } });
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: calendar?.timeZone ?? "America/Sao_Paulo" }).format(new Date());
    const end = new Date(`${today}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 30);
    const endDay = end.toISOString().slice(0, 10);

    // The administrator creates the role (CA-PAP-02).
    await enterAs(page, "Administrador");
    await page.goto("/admin?section=roles");
    const create = page.getByRole("form", { name: "Novo papel" });
    await create.locator('[name="name"]').fill(roleName);
    await create.locator('[name="description"]').fill("Cobre o catálogo durante as férias.");
    await create.getByLabel(/Gerir serviços do setor/).check();
    await create.getByRole("button", { name: "Criar papel" }).click();
    await expect(page.locator("p.feedback")).toHaveText("Papel criado.");
    await expect(roleCard(page)).toContainText("Gerir serviços do setor");
    await expect(roleCard(page)).toContainText("Atribuído a: Nenhum usuário");

    // A second role with the same name is refused.
    await create.locator('[name="name"]').fill(roleName.toUpperCase());
    await create.getByLabel(/Gerir serviços do setor/).check();
    await create.getByRole("button", { name: "Criar papel" }).click();
    await expect(page.locator("p.feedback-error")).toHaveText("Já existe um papel ativo com esse nome.");

    // Assigned to Diego for 30 days (CA-PAP-03, 04 and 05).
    await page.goto("/admin?section=users");
    const assign = rolesOf(page, "Diego Rocha").getByRole("form", { name: "Atribuir papel" });
    await assign.locator('[name="roleId"]').selectOption({ label: roleName });
    await assign.locator('[name="expiresOn"]').fill(endDay);
    await assign.getByRole("button", { name: "Atribuir papel" }).click();
    await expect(page.locator("p.feedback")).toContainText("Papéis do usuário atualizados");
    await expect(rolesOf(page, "Diego Rocha")).toContainText(`Gerir serviços do setor — vence em ${brazilian(endDay)}`);
    await expect(rolesOf(page, "Diego Rocha")).toContainText(`${roleName}: atribuído até ${brazilian(endDay)} por Marina Alves`);

    // The attendant has the sector page at once.
    const attendantContext = await browser.newContext();
    const attendant = await attendantContext.newPage();
    await enterAs(attendant, "Atendente");
    await expect(attendant.getByRole("link", { name: "Serviços do setor" })).toBeVisible();

    // Deactivating the role takes it away on the next page, without signing out (CA-PAP-03).
    await page.goto("/admin?section=roles");
    await roleCard(page).getByRole("button", { name: "Desativar" }).click();
    await expect(roleCard(page)).toContainText("Inativo");
    await attendant.goto("/sector-services");
    await expect(attendant).toHaveURL(/\/queue$/);
    await expect(attendant.getByRole("link", { name: "Serviços do setor" })).toHaveCount(0);

    // Reactivated, it counts again; once the end passes, it stops (CA-PAP-04).
    await roleCard(page).getByRole("button", { name: "Reativar" }).click();
    await expect(roleCard(page)).toContainText("Ativo");
    await attendant.goto("/sector-services");
    await expect(attendant.getByRole("heading", { name: "Serviços do setor", level: 1 })).toBeVisible();

    const yesterday = new Date(`${today}T00:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    await database.userAccessRole.updateMany({ where: { userId: diego.id }, data: { expiresOn: yesterday } });
    await attendant.goto("/sector-services");
    await expect(attendant).toHaveURL(/\/queue$/);
    await page.goto("/admin?section=users");
    await expect(rolesOf(page, "Diego Rocha")).toContainText(`vencida em ${brazilian(yesterday.toISOString().slice(0, 10))}`);
    await attendantContext.close();

    // Removing records it in the history; the audit trail has the role's changes (CA-PAP-02, 05).
    await rolesOf(page, "Diego Rocha").getByRole("button", { name: "Retirar" }).click();
    await expect(rolesOf(page, "Diego Rocha")).toContainText(`${roleName}: retirado por Marina Alves`);
    await page.goto("/admin?section=audit&type=ACCESS_ROLE");
    const audit = page.getByRole("region", { name: "Auditoria" });
    await expect(audit).toContainText(`Reativou · Papel de acesso · ${roleName}`);
    await expect(audit).toContainText(`Desativou · Papel de acesso · ${roleName}`);
    await expect(audit).toContainText(`Criou · Papel de acesso · ${roleName}`);
  } finally {
    await database.$disconnect();
  }
});
