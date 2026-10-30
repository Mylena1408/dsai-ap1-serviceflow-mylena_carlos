import { expect, test, type Page } from "@playwright/test";

const adminEmail = "e2e-admin@example.test";
const adminPassword = "E2E-only-admin-password";
const userPassword = "E2E-only-user-password";
const unique = `e2e-${Date.now()}`;
const sectorA = `${unique}-sector-a`;
const sectorB = `${unique}-sector-b`;
const category = `${unique}-category`;
const serviceA = `${unique}-service-a`;
const serviceB = `${unique}-service-b`;
const requesterAEmail = `${unique}-requester-a@example.test`;
const requesterBEmail = `${unique}-requester-b@example.test`;
const attendantAEmail = `${unique}-attendant-a@example.test`;
const attendantBEmail = `${unique}-attendant-b@example.test`;
const privateDescriptionA = `${unique}-private-request-a`;
const privateDescriptionB = `${unique}-private-request-b`;

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  const credentialsResponse = page.waitForResponse((response) =>
    response.url().includes("/api/auth/callback/credentials"),
  );
  await page.getByRole("button", { name: "Entrar" }).click();
  const response = await credentialsResponse;
  const result = (await response.json()) as { error?: string };
  expect(response.ok()).toBe(true);
  expect(result.error).toBeUndefined();
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login/);
}

async function openAdminSection(page: Page, name: string): Promise<void> {
  await page
    .getByRole("navigation", { name: "Seções administrativas" })
    .getByRole("link", { name, exact: true })
    .click();
  await expect(page.getByRole("region", { name })).toBeVisible();
}

async function createUser(
  page: Page,
  input: { name: string; email: string; role: "REQUESTER" | "ATTENDANT"; sector?: string },
): Promise<void> {
  await openAdminSection(page, "Usuários");
  const form = page.getByRole("region", { name: "Usuários" }).locator("form").first();
  await form.locator('[name="name"]').fill(input.name);
  await form.locator('[name="email"]').fill(input.email);
  await form.locator('[name="password"]').fill(userPassword);
  await form.locator('[name="role"]').selectOption(input.role);
  if (input.sector) {
    await form.locator('[name="sectorId"]').selectOption({ label: input.sector });
  }
  await form.getByRole("button", { name: "Criar usuário" }).click();
  await expect(form.getByRole("status")).toHaveText("Registro criado.");
  await expect(
    page.getByRole("region", { name: "Usuários" }).locator("ul").getByText(input.email, {
      exact: true,
    }),
  ).toBeVisible();
}

async function createService(
  page: Page,
  input: { name: string; sector: string },
): Promise<void> {
  await openAdminSection(page, "Serviços");
  const form = page.getByRole("region", { name: "Serviços" }).locator("form").first();
  await form.locator('[name="name"]').fill(input.name);
  await form.locator('[name="description"]').fill(`${input.name} details`);
  await form.locator('[name="categoryId"]').selectOption({ label: category });
  await form.locator('[name="sectorId"]').selectOption({ label: input.sector });
  await form.getByRole("button", { name: "Criar serviço" }).click();
  await expect(form.getByRole("status")).toHaveText("Registro criado.");
  await expect(
    page.getByRole("region", { name: "Serviços" }).locator("ul").getByText(input.name, {
      exact: true,
    }),
  ).toBeVisible();
}

async function openRequest(
  page: Page,
  serviceName: string,
  description: string,
): Promise<string> {
  await page.goto("/catalog");
  await page.getByRole("link", { name: serviceName }).click();
  await page.getByLabel("Descreva o que você precisa").fill(description);
  await page.getByRole("button", { name: "Enviar solicitação" }).click();
  await expect(page.getByRole("status")).toHaveText("Sua solicitação foi aberta.");
  const requestId = new URL(page.url()).pathname.split("/").at(-1);
  expect(requestId).toBeTruthy();
  return requestId!;
}

test("bootstraps login, configures services, handles requests and denies cross-scope access", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, adminEmail, adminPassword);
  await expect(page).toHaveURL(/\/admin/);
  await expect(page.getByRole("heading", { name: "Administração" })).toBeVisible();

  await openAdminSection(page, "Setores");
  const sectorSection = page.getByRole("region", { name: "Setores" });
  await sectorSection.getByLabel("Novo setor").fill(sectorA);
  await sectorSection.getByRole("button", { name: "Criar setor" }).click();
  await expect(page.getByRole("status")).toHaveText("Registro criado.");

  await sectorSection.getByLabel("Novo setor").fill(sectorB);
  await sectorSection.getByRole("button", { name: "Criar setor" }).click();
  await expect(page.getByRole("status")).toHaveText("Registro criado.");

  await openAdminSection(page, "Categorias");
  const categorySection = page.getByRole("region", { name: "Categorias" });
  await categorySection.getByLabel("Nova categoria").fill(category);
  await categorySection.getByRole("button", { name: "Criar categoria" }).click();
  await expect(page.getByRole("status")).toHaveText("Registro criado.");

  await createUser(page, {
    name: "E2E requester A",
    email: requesterAEmail,
    role: "REQUESTER",
  });
  const userSection = page.getByRole("region", { name: "Usuários" });
  // The row shows the e-mail as text when read-only and inside an input while editing.
  const requesterRow = userSection
    .locator("ul > li")
    .filter({ hasText: requesterAEmail })
    .or(
      userSection.locator("ul > li").filter({
        has: page.locator(`input[name="email"][value="${requesterAEmail}"]`),
      }),
    );
  await requesterRow.getByRole("button", { name: "Editar" }).click();
  await requesterRow.locator('[name="name"]').fill("Temporary requester name");
  await requesterRow.getByRole("button", { name: "Cancelar" }).click();
  await expect(requesterRow.getByText("E2E requester A", { exact: true })).toBeVisible();
  await requesterRow.getByRole("button", { name: "Editar" }).click();
  await requesterRow.locator('[name="name"]').fill("Updated requester name");
  await requesterRow.getByRole("button", { name: "Salvar" }).click();
  await expect(requesterRow.getByText("Updated requester name", { exact: true })).toBeVisible();
  await expect(requesterRow.getByRole("status")).toHaveText("Alterações salvas.");

  await createUser(page, {
    name: "E2E requester B",
    email: requesterBEmail,
    role: "REQUESTER",
  });
  await createUser(page, {
    name: "E2E attendant A",
    email: attendantAEmail,
    role: "ATTENDANT",
    sector: sectorA,
  });
  await createUser(page, {
    name: "E2E attendant B",
    email: attendantBEmail,
    role: "ATTENDANT",
    sector: sectorB,
  });
  await createService(page, { name: serviceA, sector: sectorA });
  await createService(page, { name: serviceB, sector: sectorB });

  await signOut(page);
  await signIn(page, requesterAEmail, userPassword);
  await expect(page).toHaveURL(/\/catalog/);
  await expect(page.getByRole("heading", { name: "Catálogo de serviços" })).toBeVisible();
  await expect(page.getByRole("link", { name: serviceA })).toBeVisible();
  await expect(page.getByRole("link", { name: serviceB })).toBeVisible();
  const requestAId = await openRequest(page, serviceA, privateDescriptionA);

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/catalog/);

  await signOut(page);
  await signIn(page, requesterBEmail, userPassword);
  await expect(page).toHaveURL(/\/catalog/);
  const foreignRequesterResponse = await page.goto(`/requests/${requestAId}`);
  expect(foreignRequesterResponse?.status()).toBe(404);
  await expect(page.getByText(privateDescriptionA)).toHaveCount(0);
  const requestBId = await openRequest(page, serviceB, privateDescriptionB);

  await signOut(page);
  await signIn(page, attendantBEmail, userPassword);
  await expect(page).toHaveURL(/\/queue/);
  const foreignAttendantResponse = await page.goto(`/queue/${requestAId}`);
  expect(foreignAttendantResponse?.status()).toBe(404);
  await expect(page.getByText(privateDescriptionA)).toHaveCount(0);

  await signOut(page);
  await signIn(page, attendantAEmail, userPassword);
  await expect(page).toHaveURL(/\/queue/);
  const otherSectorResponse = await page.goto(`/queue/${requestBId}`);
  expect(otherSectorResponse?.status()).toBe(404);
  await expect(page.getByText(privateDescriptionB)).toHaveCount(0);

  await page.goto(`/queue/${requestAId}`);
  await expect(page.getByText(privateDescriptionA)).toBeVisible();
  await page.getByRole("button", { name: "Iniciar atendimento" }).click();
  await expect(page.getByRole("status")).toHaveText("Atendimento iniciado.");
  await expect(page.getByText("Em atendimento", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Concluir solicitação" }).click();
  await expect(page.getByRole("status")).toHaveText("Solicitação concluída.");
  await expect(page.getByText("Concluída", { exact: true })).toBeVisible();

  await signOut(page);
  await signIn(page, requesterAEmail, userPassword);
  await page.goto(`/requests/${requestAId}`);
  await expect(page.getByText(privateDescriptionA)).toBeVisible();
  await expect(page.getByText("Concluída", { exact: true })).toBeVisible();
  await expect(page.getByText("Solicitação aberta: Aberta")).toBeVisible();
  await expect(page.getByText("Em atendimento → Concluída")).toBeVisible();
});
