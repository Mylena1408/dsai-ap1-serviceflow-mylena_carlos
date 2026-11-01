import { expect, test } from "@playwright/test";

// SPEC 2026-11-01-aprovacoes, section 5.1 (SF-082; CA-APR-03): the demonstration manager enters
// the "Aprovações" area and is sent back to it from every other area.

test("the manager signs in to the approvals area and cannot open the other areas", async ({ page }) => {
  await page.goto("/login");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration
  await page.getByRole("button", { name: "Entrar como Gestor" }).click();

  await expect(page).toHaveURL(/\/approvals$/);
  await expect(page.getByRole("heading", { name: "Aprovações", level: 1 })).toBeVisible();

  for (const path of ["/catalog", "/requests", "/queue", "/admin"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/approvals$/);
  }

  await page.goto("/account/password");
  await expect(page.getByRole("link", { name: "Voltar" })).toHaveAttribute("href", "/approvals");
});
