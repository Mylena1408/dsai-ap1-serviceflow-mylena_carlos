import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { ENTRANCE, passwordSignIn } from "./entrance";
import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "../../scripts/demo-data";

// SPEC 2026-11-02-auditoria-lgpd, section 8 (SF-108): the administrator changes the SLA of a
// service and sees the record in "Auditoria"; a requester downloads "Meus dados"; the
// administrator deactivates and anonymizes her, and the attendant sees her request with
// "Pessoa anonimizada" and the content removed.

const unique = `e2e-lgpd-${Date.now()}`;
const service = `${unique} Conserto de persiana`;
const person = { name: `${unique} Paula Souza`, email: `${unique}@exemplo.test`, password: "E2E-only-paula-password" };
const description = `${unique} persiana da sala da Paula travada`;
const cancelNote = "Paula resolveu sozinha";
const REMOVED = "[conteúdo removido na anonimização]";

async function enterAs(page: Page, profile: "Administrador" | "Atendente") {
  await page.goto("/");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration
  await page.getByRole("button", { name: `Entrar como ${profile}` }).click();
  await expect(page).not.toHaveURL(ENTRANCE);
}

/** There is no e-mail and password screen; the server route remains (SPEC 2026-09-30, section 24). */
async function submitPassword(page: Page): Promise<boolean> {
  const signedIn = await passwordSignIn(page, person.email, person.password);
  await page.goto("/");
  return signedIn;
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(ENTRANCE);
}

async function goToSection(page: Page, name: string) {
  await page.getByRole("navigation", { name: "Seções administrativas" }).getByRole("link", { name, exact: true }).click();
}

const recordOf = (page: Page, text: string): Locator => page.locator("ul.entity-list > li").filter({ hasText: text }).first();

test("audit of an SLA change, \"Meus dados\" and anonymization", async ({ page }) => {
  test.setTimeout(300_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  try {
    await seedDemoData(database);
  } finally {
    await database.$disconnect();
  }

  // Administrator creates a service with a 24 h SLA, changes it to 12 h and creates Paula.
  await enterAs(page, "Administrador");
  await goToSection(page, "Serviços");
  const serviceForm = page.getByRole("region", { name: "Serviços" }).locator("form").first();
  await serviceForm.locator('[name="name"]').fill(service);
  await serviceForm.locator('[name="description"]').fill("Serviço do teste de auditoria.");
  await serviceForm.locator('[name="categoryId"]').selectOption({ label: "Manutenção" });
  await serviceForm.locator('[name="sectorId"]').selectOption({ label: "Central de Serviços" });
  await serviceForm.locator('[name="slaHours"]').fill("24");
  await serviceForm.getByRole("button", { name: "Criar serviço" }).click();
  await expect(serviceForm.getByRole("status")).toHaveText("Registro criado.");

  await recordOf(page, service).getByRole("button", { name: "Editar", exact: true }).first().click();
  // While editing, the name is only in the input: the open editor is the single edit form.
  const editor = page.locator("form.entity-editor-form");
  await editor.locator('[name="slaHours"]').fill("12");
  await editor.getByRole("button", { name: "Salvar" }).click();
  await expect(recordOf(page, service)).toContainText("Prazo-base: 12 h");

  await goToSection(page, "Usuários");
  const userForm = page.getByRole("region", { name: "Usuários" }).locator("form").first();
  await userForm.locator('[name="name"]').fill(person.name);
  await userForm.locator('[name="email"]').fill(person.email);
  await userForm.locator('[name="password"]').fill(person.password);
  await userForm.locator('[name="role"]').selectOption("REQUESTER");
  await userForm.getByRole("button", { name: "Criar usuário" }).click();
  await expect(userForm.getByRole("status")).toHaveText("Registro criado.");

  // The change of SLA is in "Auditoria", with the values (CA-AUD-02, 03, 04).
  await page.goto("/admin?section=audit&type=SERVICE");
  const serviceEntry = page.locator("ul.audit-list > li").filter({ hasText: `Alterou · Serviço · ${service}` });
  await expect(serviceEntry).toContainText("Prazo-base (horas): 24 → 12");
  await expect(serviceEntry).toContainText("Marina Alves · Administrador");
  await signOut(page);

  // Paula opens a request, downloads her data and cancels the request (CA-AUD-06).
  expect(await submitPassword(page)).toBe(true);
  await expect(page).toHaveURL(/\/catalog/);
  await page.goto("/catalog");
  await page.getByRole("link", { name: service }).click();
  await page.getByLabel("Descreva o que você precisa").fill(description);
  await page.getByRole("button", { name: "Enviar solicitação" }).click();
  await expect(page.getByRole("status")).toHaveText("Sua solicitação foi aberta.");
  const requestId = new URL(page.url()).pathname.split("/").at(-1)!;

  await page.getByRole("link", { name: "Meus dados" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Baixar meus dados" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^serviceflow-meus-dados-\d{4}-\d{2}-\d{2}\.json$/);
  const file = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(file.pessoa).toMatchObject({ nome: person.name, email: person.email, perfil: "Solicitante" });
  expect(file.solicitacoesQueVoceAbriu).toEqual([expect.objectContaining({ descricao: description })]);
  expect(JSON.stringify(file)).not.toContain("argon2");

  await page.goto(`/requests/${requestId}`);
  await page.getByText("Cancelar solicitação").click();
  await page.getByLabel("Motivo (opcional)").fill(cancelNote);
  await page.getByRole("button", { name: "Confirmar cancelamento" }).click();
  await expect(page.locator("p.feedback")).toHaveText("Sua solicitação foi cancelada.");
  await signOut(page);

  // Administrator deactivates and anonymizes Paula (CA-AUD-07, 08, 09).
  await enterAs(page, "Administrador");
  await page.goto("/admin?section=users");
  await expect(recordOf(page, person.name).getByRole("region", { name: "Anonimização" })).toHaveCount(0);
  await recordOf(page, person.name).getByRole("button", { name: "Desativar" }).click();
  await recordOf(page, person.name).getByRole("checkbox").check();
  await recordOf(page, person.name).getByRole("button", { name: "Anonimizar" }).click();
  await expect(page.getByText("Pessoa anonimizada.", { exact: true })).toBeVisible();
  await expect(page.locator("ul.entity-list > li").filter({ hasText: person.name })).toHaveCount(0);
  const anonymizedName = (await page.locator("ul.entity-list > li").filter({ hasText: "Anonimizado em" }).first().locator("strong").textContent())!;
  expect(anonymizedName).toMatch(/^Pessoa anonimizada [0-9a-f]{12}$/);

  await page.goto("/admin?section=audit&type=USER");
  const audit = page.getByRole("region", { name: "Auditoria" });
  await expect(audit.locator("ul.audit-list > li").filter({ hasText: `Anonimizou · Usuário · ${anonymizedName}` })).toContainText(
    "E-mail: alterado",
  );
  await expect(audit).not.toContainText(person.name);
  await expect(audit).not.toContainText(person.email);
  await signOut(page);

  // Paula can no longer sign in: no session starts and the root shows the profile choice.
  expect(await submitPassword(page)).toBe(false);
  await expect(page).toHaveURL(ENTRANCE);
  await expect(page.getByRole("button", { name: "Entrar como Administrador" })).toBeVisible();

  // The attendant still sees the request, with the anonymized requester and the content removed.
  await enterAs(page, "Atendente");
  await page.goto(`/queue/${requestId}`);
  const article = page.locator("main");
  await expect(article).toContainText(anonymizedName);
  await expect(article).toContainText(REMOVED);
  await expect(page.locator("article .status-pill")).toHaveText("Cancelada");
  for (const absent of [person.name, person.email, description, cancelNote]) {
    await expect(article).not.toContainText(absent);
  }
});
