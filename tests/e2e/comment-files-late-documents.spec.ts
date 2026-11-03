import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "../../scripts/demo-data";
import { minimalPdf, syntheticText } from "../unit/modules/attachments/synthetic-files";
import { ENTRANCE } from "./entrance";

// SPEC 2026-11-03-anexos-comentarios-documentos, section 8 (SF-127): the requester opens a request
// leaving the optional document for later (the empty file input fixed in SF-125), sends it later
// and comments with a PDF; the attendant downloads the PDF and writes an internal note with a file,
// which the requester neither sees nor downloads.

const unique = `e2e-anexos-${Date.now()}`;
const description = `${unique} mudei de endereço`;
const sha256 = (bytes: Uint8Array | Buffer) => createHash("sha256").update(bytes).digest("hex");

async function enterAs(page: Page, profile: "Solicitante" | "Atendente") {
  await page.goto("/");
  await page.waitForLoadState("networkidle"); // buttons only work after hydration
  await page.getByRole("button", { name: `Entrar como ${profile}` }).click();
  await expect(page).not.toHaveURL(ENTRANCE);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(ENTRANCE);
}

test("files in comments and a document sent after the opening", async ({ page }) => {
  test.setTimeout(240_000);
  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  const pdf = Buffer.from(minimalPdf());
  const note = Buffer.from(syntheticText());

  try {
    await seedDemoData(database);

    // The requester opens with the required document only; the optional one stays empty.
    await enterAs(page, "Solicitante");
    await page.goto("/catalog");
    await page.getByRole("link", { name: "Atualização cadastral" }).first().click();
    await page.getByLabel("Descreva o que você precisa").fill(description);
    await page.getByLabel("Comprovante de residência (obrigatório)").setInputFiles({ name: "comprovante.pdf", mimeType: "application/pdf", buffer: pdf });
    await page.getByRole("button", { name: "Enviar solicitação" }).click();
    await expect(page.getByRole("status")).toHaveText("Sua solicitação foi aberta.");
    const requestId = new URL(page.url()).pathname.split("/").at(-1)!;
    await signOut(page);

    // The attendant assumes it, so the later document notifies someone.
    await enterAs(page, "Atendente");
    await page.goto(`/queue/${requestId}`);
    await page.getByRole("button", { name: "Assumir" }).click();
    await expect(page.locator("p.feedback")).toHaveText("Você assumiu esta solicitação.");
    await signOut(page);

    // The requester sends the missing document and comments with a PDF (CA-ANX-02 and 05).
    await enterAs(page, "Solicitante");
    await page.goto(`/requests/${requestId}`);
    const late = page.getByRole("region", { name: "Enviar documento que falta" });
    await late.getByLabel("Documento").selectOption({ label: "Certidão de dependente (opcional; PDF)" });
    await late.getByLabel("Arquivo").setInputFiles({ name: "certidao.pdf", mimeType: "application/pdf", buffer: pdf });
    await late.getByRole("button", { name: "Enviar documento" }).click();
    await expect(page.locator("p.feedback")).toHaveText("Documento enviado.");
    await expect(page.getByRole("region", { name: "Enviar documento que falta" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Baixar certidao.pdf" })).toBeVisible();
    await expect(page.locator("ol.history-list")).toContainText("Documento enviado: Certidão de dependente");

    await page.getByLabel("Novo comentário").fill(`${unique} segue o laudo`);
    await page.getByLabel("Arquivos (opcional)").setInputFiles({ name: "laudo.pdf", mimeType: "application/pdf", buffer: pdf });
    await page.getByRole("button", { name: "Enviar comentário" }).click();
    await expect(page.locator("p.feedback")).toHaveText("Comentário enviado.");
    await expect(page.getByRole("link", { name: "laudo.pdf" })).toBeVisible();
    await signOut(page);

    await expect
      .poll(() => database.requestNotification.count({ where: { requestId, type: "document.added" } }), { timeout: 30_000 })
      .toBe(1);

    // The attendant downloads the same PDF and writes an internal note with a file (CA-ANX-04).
    await enterAs(page, "Atendente");
    await page.goto(`/queue/${requestId}`);
    await expect(page.locator("ol.history-list")).toContainText("Documento enviado: Certidão de dependente");
    const href = await page.getByRole("link", { name: "laudo.pdf" }).getAttribute("href");
    expect(href).toMatch(new RegExp(`^/api/requests/${requestId}/comments/[0-9a-f-]{36}/files/[0-9a-f-]{36}$`));
    const download = await page.request.get(href!);
    expect(download.status()).toBe(200);
    expect(download.headers()["content-type"]).toBe("application/pdf");
    expect(download.headers()["cache-control"]).toBe("private, no-store");
    expect(sha256(await download.body())).toBe(sha256(pdf));

    await page.getByLabel("Novo comentário").fill(`${unique} orçamento interno`);
    await page.getByLabel("Arquivos (opcional)").setInputFiles({ name: "orcamento.txt", mimeType: "text/plain", buffer: note });
    await page.getByLabel("Nota interna (o solicitante não vê)").check();
    await page.getByRole("button", { name: "Enviar comentário" }).click();
    await expect(page.locator("p.feedback")).toHaveText("Comentário enviado.");
    const internalHref = await page.getByRole("link", { name: "orcamento.txt" }).getAttribute("href");
    await signOut(page);

    // The requester sees neither the note nor its file, and the direct link answers 404.
    await enterAs(page, "Solicitante");
    await page.goto(`/requests/${requestId}`);
    await expect(page.locator("body")).not.toContainText("orcamento.txt");
    expect((await page.request.get(internalHref!)).status()).toBe(404);

    // A file in an unaccepted format is refused with the fixed message (CA-ANX-03).
    await page.getByLabel("Novo comentário").fill(`${unique} arquivo errado`);
    await page.getByLabel("Arquivos (opcional)").setInputFiles({ name: "foto.pdf", mimeType: "application/pdf", buffer: note });
    await page.getByRole("button", { name: "Enviar comentário" }).click();
    await expect(page.locator("p.feedback-error")).toContainText("Arquivos não aceitos");
    await expect(page.locator("body")).not.toContainText(`${unique} arquivo errado`);
  } finally {
    await database.$disconnect();
  }
});
