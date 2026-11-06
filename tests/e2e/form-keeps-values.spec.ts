import { expect, test } from "@playwright/test";
import { ENTRANCE } from "./entrance";

// SPEC 2026-11-06-formularios-mantem-dados, section 6 (SF-158): a refused submission keeps what was
// typed (CA-FMD-01 and 02); a successful creation still clears the form.

const unique = `e2e-form-${Date.now()}`;
const first = { name: `${unique} Ana Prado`, email: `${unique}-ana@exemplo.test` };
const second = { name: `${unique} Bruno Reis`, email: `${unique}-bruno@exemplo.test` };
const password = "E2E-only-form-password";

test("refused admin forms keep the typed values; a successful creation clears the form", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration
  await page.getByRole("button", { name: "Entrar como Administrador" }).click();
  await expect(page).not.toHaveURL(ENTRANCE);
  await page.goto("/admin?section=users");

  const form = page.locator("form.create-form").filter({ has: page.getByRole("button", { name: "Criar usuário" }) });
  const name = form.getByLabel("Nome");
  const email = form.getByLabel("E-mail");
  const role = form.getByLabel("Perfil");
  const sector = form.getByLabel("Setor da equipe");

  async function fill(user: { name: string; email: string }) {
    await name.fill(user.name);
    await email.fill(user.email);
    await form.getByLabel("Senha inicial").fill(password);
    await role.selectOption("ATTENDANT");
    await sector.selectOption({ index: 1 });
  }

  await fill(first);
  await form.getByRole("button", { name: "Criar usuário" }).click();
  await expect(form.getByRole("status")).toBeVisible();
  await expect(name).toHaveValue("");
  await expect(page.locator("ul.entity-list > li").filter({ hasText: first.name })).toBeVisible();

  // CA-FMD-01: the repeated e-mail is refused and nothing typed is lost.
  await fill({ name: second.name, email: first.email });
  const chosenSector = await sector.inputValue();
  await form.getByRole("button", { name: "Criar usuário" }).click();
  await expect(form.getByRole("alert")).toBeVisible();
  await expect(name).toHaveValue(second.name);
  await expect(email).toHaveValue(first.email);
  await expect(role).toHaveValue("ATTENDANT");
  await expect(sector).toHaveValue(chosenSector);

  await email.fill(second.email);
  await form.getByRole("button", { name: "Criar usuário" }).click();
  await expect(form.getByRole("status")).toBeVisible();
  await expect(name).toHaveValue("");
  await expect(email).toHaveValue("");

  // CA-FMD-02: an edit refused for the repeated e-mail keeps the value being corrected.
  const item = page.locator("ul.entity-list > li").filter({ hasText: second.name });
  await item.getByRole("button", { name: "Editar" }).click();
  const editor = page.locator("form.entity-editor-form"); // the only editor open; it replaces the summary with the name
  await editor.getByLabel("E-mail").fill(first.email);
  await editor.getByRole("button", { name: /Salvar/ }).click();
  await expect(editor.getByRole("alert")).toBeVisible();
  await expect(editor.getByLabel("E-mail")).toHaveValue(first.email);
});
