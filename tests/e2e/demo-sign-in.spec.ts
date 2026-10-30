import { expect, test } from "@playwright/test";

// SPEC 2026-09-30, section 22 (CA-DEMO-01): each button enters its profile area
// without e-mail or password.
const profiles = [
  { button: "Entrar como Administrador", url: /\/admin/, heading: "Administração" },
  { button: "Entrar como Solicitante", url: /\/catalog/, heading: "Catálogo de serviços" },
  { button: "Entrar como Atendente", url: /\/queue/, heading: "Fila do meu setor" },
];

test("enters each profile from the login buttons without e-mail or password", async ({ page }) => {
  for (const profile of profiles) {
    await page.goto("/login");
    await expect(page.getByLabel("E-mail")).toBeHidden();
    await page.getByRole("button", { name: profile.button }).click();

    await expect(page).toHaveURL(profile.url);
    await expect(page.getByRole("heading", { name: profile.heading })).toBeVisible();

    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/login/);
  }
});
