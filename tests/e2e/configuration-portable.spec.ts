import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { ENTRANCE } from "./entrance";
import { seedDemoData } from "../../scripts/demo-data";

// SPEC 2026-11-07-operacao-e-automacao, section 8, part D (SF-190; CA-CFG-01 to 05 through the screens): the
// administrator exports the configuration, imports it back with a new category (preview, then apply), sees a
// broken file refused with its problems, and finds both in the audit trail. The empty database, the
// all-or-nothing transaction and the changed destination are covered by configuration-import.test.ts.

const unique = `e2e-config-${Date.now()}`;
const categoryName = `${unique} Categoria`;

async function enterAsAdministrator(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration
  await page.getByRole("button", { name: "Entrar como Administrador" }).click();
  await expect(page).not.toHaveURL(ENTRANCE);
}

const upload = (text: string) => ({ name: "configuracao.json", mimeType: "application/json", buffer: Buffer.from(text, "utf8") });

test("portable configuration: export, preview, apply and a refused file", async ({ page }) => {
  test.setTimeout(240_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  try {
    await seedDemoData(database);
  } finally {
    await database.$disconnect();
  }

  try {
    await enterAsAdministrator(page);
    await page.goto("/admin?section=configuration");
    await expect(page.getByRole("heading", { name: "Exportar a configuração" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Nomes repetidos" })).toHaveCount(0);

    // Export (CA-CFG-01 and 02).
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exportar configuração" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^serviceflow-configuracao-\d{4}-\d{2}-\d{2}\.json$/);
    const exported = await readFile((await download.path())!, "utf8");
    const file = JSON.parse(exported);
    expect(file).toMatchObject({ format: "serviceflow-config", version: 2 });
    expect(file.data.sectors.map((sector: { name: string }) => sector.name)).toContain("Central de Serviços");
    expect(exported).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    expect(exported).not.toContain("passwordHash");

    // A broken file is refused whole, with its problems (CA-CFG-03).
    const broken = structuredClone(file);
    broken.data.categories.push({ name: " ", isActive: true });
    await page.getByLabel("Arquivo de configuração (JSON, até 2 MB)").setInputFiles(upload(JSON.stringify(broken)));
    await page.getByRole("button", { name: "Ver prévia" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "O arquivo foi recusado" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Problemas do arquivo" })).toContainText("categories ›   › name");
    await expect(page.getByRole("button", { name: "Aplicar a importação" })).toHaveCount(0);

    // The exported file plus a new category: preview, then apply (CA-CFG-03 to 05).
    file.data.categories.push({ name: categoryName, isActive: true });
    await page.getByLabel("Arquivo de configuração (JSON, até 2 MB)").setInputFiles(upload(JSON.stringify(file, null, 2)));
    await page.getByRole("button", { name: "Ver prévia" }).click();
    const previewSection = page.getByRole("region", { name: "Prévia de configuracao.json" });
    await expect(previewSection).toContainText(/1 item novo, 0 alterados e \d+ iguais\./);
    const row = previewSection.getByRole("row", { name: new RegExp(categoryName) });
    await expect(row).toContainText("Categoria");
    await expect(row).toContainText("Novo");
    await previewSection.getByRole("button", { name: "Aplicar a importação" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Importação aplicada." })).toContainText("1 item novo");

    // The category exists; importing the same file again changes nothing.
    await page.goto("/admin?section=categories");
    await expect(page.getByText(categoryName).first()).toBeVisible();
    await page.goto("/admin?section=configuration");
    await page.getByLabel("Arquivo de configuração (JSON, até 2 MB)").setInputFiles(upload(JSON.stringify(file, null, 2)));
    await page.getByRole("button", { name: "Ver prévia" }).click();
    await expect(page.getByText("Tudo no arquivo já está igual neste ambiente: não há o que aplicar.")).toBeVisible();

    // Both actions are in the audit trail (CA-CFG-01).
    await page.goto("/admin?section=audit&type=CONFIGURATION");
    const audit = page.getByRole("region", { name: "Auditoria" });
    await expect(audit).toContainText("Importou · Configuração da organização");
    await expect(audit).toContainText("Exportou · Configuração da organização");
  } finally {
    // Later tests of the run start without the imported category.
    const cleanup = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
    try {
      await cleanup.category.deleteMany({ where: { name: categoryName } });
    } finally {
      await cleanup.$disconnect();
    }
  }
});
