import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError, ConflictError, ValidationError } from "@/server/errors";

const configuration = vi.hoisted(() => ({
  exportConfiguration: vi.fn(),
  previewConfigurationImport: vi.fn(),
  applyConfigurationImport: vi.fn(),
}));
vi.mock("@/modules/configuration", () => ({ ...configuration, MAX_CONFIGURATION_BYTES: 2 * 1024 * 1024 }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { GET } from "@/app/api/configuration/export/route";
import { applyImportAction, previewImportAction } from "@/app/(admin)/admin/_sections/configuration/actions";
import { ConfigurationSection } from "@/app/(admin)/admin/_sections/configuration/configuration-section";

// SPEC 2026-11-07-operacao-e-automacao, part D (SF-190; CA-CFG-01 to 05 through the screens).

const preview = {
  accepted: true,
  problems: [],
  problemCount: 0,
  warnings: [],
  items: [],
  summary: { new: 1, changed: 0, equal: 3 },
  digest: "a".repeat(64),
  destinationDigest: "b".repeat(64),
};

beforeEach(() => vi.clearAllMocks());

describe("the export (6.3 items 1 to 3)", () => {
  it("downloads the file without caching it", async () => {
    configuration.exportConfiguration.mockResolvedValue({ fileName: "serviceflow-configuracao-2026-11-08.json", content: '{"format":"serviceflow-config"}\n' });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="serviceflow-configuracao-2026-11-08.json"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe('{"format":"serviceflow-config"}\n');
  });

  it("refuses anyone but the administrator", async () => {
    configuration.exportConfiguration.mockRejectedValue(new AuthorizationError());
    const response = await GET();
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Só o administrador exporta a configuração.");
  });

  it("the section warns about repeated names and the size before exporting", () => {
    const clean = renderToStaticMarkup(createElement(ConfigurationSection, { check: { repeated: [], bytes: 20_480, tooLarge: false } }));
    expect(clean).toContain("Tamanho previsto: 20 KB.");
    expect(clean).not.toContain("impedirão a importação");
    expect(clean).toContain('action="/api/configuration/export"');
    expect(clean).toContain("Ver prévia");

    const warned = renderToStaticMarkup(
      createElement(ConfigurationSection, { check: { repeated: ["serviços: Mesa"], bytes: 3 * 1024 * 1024, tooLarge: true } }),
    );
    expect(warned).toContain("Tamanho previsto: 3,0 MB.");
    expect(warned).toContain("O arquivo passará de 2 MB e não poderá ser importado.");
    expect(warned).toContain("<li>serviços: Mesa</li>");
  });
});

describe("the import from the screen (6.3 items 4 and 5)", () => {
  const form = (entries: Record<string, string | File>) => {
    const data = new FormData();
    for (const [name, value] of Object.entries(entries)) data.append(name, value);
    return data;
  };

  it("sends the file's text for the preview and keeps it for the application", async () => {
    configuration.previewConfigurationImport.mockResolvedValue(preview);
    const file = new File(['{"format":"serviceflow-config"}'], "config.json", { type: "application/json" });
    await expect(previewImportAction({ step: "idle" }, form({ file }))).resolves.toEqual({
      step: "preview",
      preview,
      content: '{"format":"serviceflow-config"}',
      fileName: "config.json",
    });
    expect(configuration.previewConfigurationImport).toHaveBeenCalledWith('{"format":"serviceflow-config"}');
  });

  it("uses LF line breaks in both steps, because a form sends CRLF (the digests must match)", async () => {
    configuration.previewConfigurationImport.mockResolvedValue(preview);
    configuration.applyConfigurationImport.mockResolvedValue({ new: 0, changed: 0, equal: 1 });
    const file = new File(["{\r\n  \"format\": 1\r\n}\r\n"], "windows.json");
    const state = await previewImportAction({ step: "idle" }, form({ file }));
    expect(state.step === "preview" && state.content).toBe('{\n  "format": 1\n}\n');

    await applyImportAction({ step: "idle" }, form({ content: '{\r\n  "format": 1\r\n}\r\n', digest: preview.digest, destinationDigest: preview.destinationDigest }));
    expect(configuration.applyConfigurationImport).toHaveBeenCalledWith(expect.objectContaining({ content: '{\n  "format": 1\n}\n' }));
  });

  it("refuses a missing or oversized file without reading it", async () => {
    await expect(previewImportAction({ step: "idle" }, form({}))).resolves.toMatchObject({ step: "error" });
    const big = new File(["x".repeat(2 * 1024 * 1024 + 1)], "big.json");
    await expect(previewImportAction({ step: "idle" }, form({ file: big }))).resolves.toEqual({ step: "error", message: "O arquivo passa de 2 MB." });
    expect(configuration.previewConfigurationImport).not.toHaveBeenCalled();
  });

  it("applies the same text with the preview's digests, and explains a refusal", async () => {
    configuration.applyConfigurationImport.mockResolvedValue({ new: 1, changed: 0, equal: 3 });
    const confirmation = { content: "{}", digest: preview.digest, destinationDigest: preview.destinationDigest };
    await expect(applyImportAction({ step: "idle" }, form(confirmation))).resolves.toEqual({ step: "applied", summary: { new: 1, changed: 0, equal: 3 } });
    expect(configuration.applyConfigurationImport).toHaveBeenCalledWith(confirmation);

    for (const [error, text] of [
      [new ConflictError(), "mudou desde a prévia"],
      [new ValidationError([]), "não pode ser aplicado"],
      [new AuthorizationError(), "Só o administrador"],
    ] as const) {
      configuration.applyConfigurationImport.mockRejectedValueOnce(error);
      const state = await applyImportAction({ step: "idle" }, form(confirmation));
      expect(state).toMatchObject({ step: "error" });
      expect(state.step === "error" && state.message).toContain(text);
    }
  });
});
