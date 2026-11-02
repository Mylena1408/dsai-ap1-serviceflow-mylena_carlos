import { expect, test } from "@playwright/test";
import { ENTRANCE } from "./entrance";

// SPEC 2026-09-30, section 22 (CA-DEMO-01) and section 24 (CA-ENT-01 to 03): the root is the
// entrance, each button enters its profile area, and no screen asks for e-mail or password.
const profiles = [
  { button: "Entrar como Administrador", url: /\/admin/, heading: "Administração" },
  { button: "Entrar como Solicitante", url: /\/catalog/, heading: "Catálogo de serviços" },
  { button: "Entrar como Atendente", url: /\/queue/, heading: "Fila do meu setor" },
];

test("enters each profile from the entrance without e-mail or password", async ({ page }) => {
  for (const profile of profiles) {
    await page.goto("/");
    await page.waitForLoadState("networkidle"); // buttons only work after hydration
    await expect(page.getByRole("heading", { name: "Escolha um perfil" })).toBeVisible();
    await expect(page.locator('input[type="password"], input[type="email"]')).toHaveCount(0);
    await page.getByRole("button", { name: profile.button }).click();

    await expect(page).toHaveURL(profile.url);
    await expect(page.getByRole("heading", { name: profile.heading })).toBeVisible();

    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(ENTRANCE);
  }
});

test("the old login address and protected pages without a session lead to the entrance", async ({ page }) => {
  for (const path of ["/login", "/admin", "/catalog", "/queue"]) {
    await page.goto(path);
    await expect(page).toHaveURL(ENTRANCE);
    await expect(page.getByRole("button", { name: "Entrar como Solicitante" })).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  }
});
