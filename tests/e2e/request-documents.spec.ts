import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Download, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "../../scripts/demo-data";
import { minimalPdf, syntheticText } from "../unit/modules/attachments/synthetic-files";

// SPEC 2026-09-30, sections 21.12 and 21.13 (SF-036). Synthetic files only (CA-DOC-22);
// the E2E server stores them in memory (TEST_DOCUMENT_STORAGE=memory).

const unique = `e2e-docs-${Date.now()}`;
const serviceName = `${unique} Licença`;
const requiredDocument = `${unique} Requerimento`;
const optionalDocument = `${unique} Observação`;
const pdf = Buffer.from(minimalPdf());
const text = Buffer.from(syntheticText());

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function enterAs(page: Page, profile: "Administrador" | "Solicitante" | "Atendente") {
  await page.goto("/login");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration
  await page.getByRole("button", { name: `Entrar como ${profile}` }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login/);
}

async function addRequirement(
  page: Page,
  panel: ReturnType<Page["locator"]>,
  input: { name: string; required: boolean; format: "PDF" | "TXT" },
) {
  const form = panel.locator("form.create-form");
  await form.getByLabel("Nome do documento").fill(input.name);
  await form.getByLabel("Obrigatoriedade").selectOption(input.required ? "true" : "false");
  await form.getByRole("checkbox", { name: input.format }).check();
  await form.getByRole("button", { name: "Adicionar documento" }).click();
  await expect(panel.locator(".requirement-list").getByText(input.name, { exact: true })).toBeVisible();
}

async function downloadedBytes(page: Page, linkName: string): Promise<Buffer> {
  const [download]: [Download, void] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: linkName }).click(),
  ]);
  return readFile((await download.path())!);
}

test("documents are configured, required, sent, downloaded and protected", async ({ page }) => {
  test.setTimeout(180_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  try {
    await seedDemoData(database);
  } finally {
    await database.$disconnect();
  }

  // Administrator configures the documents of an example service (CA-DOC-01).
  await enterAs(page, "Administrador");
  await page
    .getByRole("navigation", { name: "Seções administrativas" })
    .getByRole("link", { name: "Serviços", exact: true })
    .click();
  const services = page.getByRole("region", { name: "Serviços" });
  const serviceForm = services.locator("form").first();
  await serviceForm.locator('[name="name"]').fill(serviceName);
  await serviceForm.locator('[name="description"]').fill("Serviço de exemplo com documentos exigidos.");
  await serviceForm.locator('[name="categoryId"]').selectOption({ label: "RH" });
  await serviceForm.locator('[name="sectorId"]').selectOption({ label: "Setor de demonstração" });
  await serviceForm.getByRole("button", { name: "Criar serviço" }).click();
  const serviceItem = services.locator("li.entity-item").filter({ hasText: serviceName });
  await expect(serviceItem).toBeVisible();
  const panel = serviceItem.getByRole("region", { name: "Documentos exigidos" });
  await addRequirement(page, panel, { name: requiredDocument, required: true, format: "PDF" });
  await addRequirement(page, panel, { name: optionalDocument, required: false, format: "TXT" });
  await signOut(page);

  // Requester sees the list (CA-DOC-06) and cannot send without the required file (CA-DOC-07).
  await enterAs(page, "Solicitante");
  await page.goto("/catalog");
  await page.getByRole("link", { name: serviceName }).click();
  const requiredInput = page.getByLabel(`${requiredDocument} (obrigatório)`);
  const optionalInput = page.getByLabel(`${optionalDocument} (opcional)`);
  await expect(requiredInput).toBeVisible();
  await expect(optionalInput).toBeVisible();
  await expect(page.getByText("Formatos aceitos: PDF", { exact: true })).toBeVisible();
  await expect(page.getByText("Formatos aceitos: TXT", { exact: true })).toBeVisible();

  const description = `${unique} pedido com documentos`;
  await page.getByLabel("Descreva o que você precisa").fill(description);
  await page.getByRole("button", { name: "Enviar solicitação" }).click();
  await expect(requiredInput).toHaveJSProperty("validity.valueMissing", true);
  await expect(page).toHaveURL(/\/catalog\//);

  // Without the browser check, the server refuses it too.
  await requiredInput.evaluate((input) => input.removeAttribute("required"));
  await page.getByRole("button", { name: "Enviar solicitação" }).click();
  await expect(page.locator("p.feedback-error[role=alert]")).toContainText("Os documentos não foram aceitos.");
  await expect(page).toHaveURL(/error=attachments/);

  await page.getByLabel("Descreva o que você precisa").fill(description);
  await requiredInput.setInputFiles({ name: "requerimento.pdf", mimeType: "application/pdf", buffer: pdf });
  await optionalInput.setInputFiles({ name: "observacao.txt", mimeType: "text/plain", buffer: text });
  await page.getByRole("button", { name: "Enviar solicitação" }).click();
  await expect(page.getByRole("status")).toHaveText("Sua solicitação foi aberta.");
  const requestId = new URL(page.url()).pathname.split("/").at(-1)!;

  // Requester lists and downloads the same content (CA-DOC-15, CA-DOC-14).
  const documents = page.getByRole("region", { name: "Documentos enviados" });
  await expect(documents.getByText(`${requiredDocument} (obrigatório)`)).toBeVisible();
  expect(sha256(await downloadedBytes(page, "Baixar requerimento.pdf"))).toBe(sha256(pdf));
  const href = await page.getByRole("link", { name: "Baixar observacao.txt" }).getAttribute("href");
  expect(href).toMatch(new RegExp(`^/api/requests/${requestId}/attachments/[0-9a-f-]{36}$`));

  // Response headers and no storage key or public URL (CA-DOC-18).
  const response = await page.request.get(href!);
  expect(response.status()).toBe(200);
  expect(response.headers()).toMatchObject({
    "content-type": "text/plain",
    "content-disposition": "attachment; filename=\"observacao.txt\"; filename*=UTF-8''observacao.txt",
    "x-content-type-options": "nosniff",
    "cache-control": "private, no-store",
  });
  expect(sha256(await response.body())).toBe(sha256(text));
  // The storage key is requests/<requestId>/<attachmentId>; links only use the API path.
  const html = await page.content();
  for (const link of await documents.getByRole("link").all()) {
    const attachmentId = (await link.getAttribute("href"))!.split("/").at(-1);
    expect(html).not.toContain(`requests/${requestId}/${attachmentId}`);
  }
  expect(html).not.toContain("supabase");
  await signOut(page);

  // Attendant of the sector downloads it (CA-DOC-14).
  await enterAs(page, "Atendente");
  await page.goto(`/queue/${requestId}`);
  await expect(page.getByText(description)).toBeVisible();
  expect(sha256(await downloadedBytes(page, "Baixar requerimento.pdf"))).toBe(sha256(pdf));
  await signOut(page);

  // Administrator and anonymous users get the same "not found" (CA-DOC-16).
  await enterAs(page, "Administrador");
  const adminResponse = await page.request.get(href!);
  const adminBody = await adminResponse.text();
  await signOut(page);
  const anonymousResponse = await page.request.get(href!);
  const anonymousBody = await anonymousResponse.text();

  expect(adminResponse.status()).toBe(404);
  expect(anonymousResponse.status()).toBe(404);
  expect(adminBody).toBe(anonymousBody);
  expect(adminBody).not.toContain("observacao");
});
