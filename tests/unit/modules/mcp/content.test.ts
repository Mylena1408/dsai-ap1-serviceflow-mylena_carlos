import { describe, expect, it } from "vitest";
import {
  INTERNAL_ERROR_MESSAGE,
  NOT_FOUND_MESSAGE,
  commentFileUri,
  fileResult,
  requestDocumentUri,
  structuredResult,
  toolError,
} from "@/modules/mcp/domain/content";
import { minimalPdf } from "../attachments/synthetic-files";

// SPEC 2026-11-05-mcp-documentos, 5.4 items 5 and 6 (SF-139).

const encoder = new TextEncoder();

describe("fileResult", () => {
  it("returns TXT as text after a short summary", () => {
    const result = fileResult({
      uri: "serviceflow://requests/r/documents/a",
      filename: "nota.txt",
      contentType: "text/plain; charset=utf-8",
      bytes: encoder.encode("Férias de 10/01 a 24/01."),
    });
    expect(result.isError).toBe(false);
    expect(result.content).toEqual([
      { type: "text", text: 'File "nota.txt" (text/plain; charset=utf-8, 25 B).' },
      { type: "text", text: "Férias de 10/01 a 24/01." },
    ]);
  });

  it("returns PDF as a base64 embedded resource with the detected type and the same bytes", () => {
    const bytes = minimalPdf();
    const result = fileResult({ uri: "serviceflow://requests/r/documents/a", filename: "x.pdf", contentType: "application/pdf", bytes });
    expect(result.content).toHaveLength(2);
    const block = result.content[1];
    expect(block.type).toBe("resource");
    if (block.type !== "resource") return;
    expect(block.resource.uri).toBe("serviceflow://requests/r/documents/a");
    expect(block.resource.mimeType).toBe("application/pdf");
    expect(Buffer.from(block.resource.blob, "base64").equals(Buffer.from(bytes))).toBe(true);
  });

  it("returns DOCX as an embedded resource", () => {
    const type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const result = fileResult({ uri: "u", filename: "x.docx", contentType: type, bytes: new Uint8Array([0x50, 0x4b, 3, 4]) });
    expect(result.content[1]).toEqual({ type: "resource", resource: { uri: "u", mimeType: type, blob: "UEsDBA==" } });
  });

  it("falls back to base64 when a text file is not valid UTF-8", () => {
    const result = fileResult({ uri: "u", filename: "x.txt", contentType: "text/plain", bytes: new Uint8Array([0xff, 0xfe]) });
    expect(result.content[1]).toEqual({ type: "resource", resource: { uri: "u", mimeType: "text/plain", blob: "//4=" } });
  });

  it("states sizes in bytes, KiB or MiB", () => {
    const sizes = [
      [10, "10 B"],
      [2048, "2.0 KiB"],
      [2 * 1024 * 1024, "2.00 MiB"],
    ] as const;
    for (const [size, label] of sizes) {
      const result = fileResult({ uri: "u", filename: "x.pdf", contentType: "application/pdf", bytes: new Uint8Array(size) });
      expect(result.content[0]).toEqual({ type: "text", text: `File "x.pdf" (application/pdf, ${label}).` });
    }
  });
});

describe("structured and error results", () => {
  it("repeats structured content as JSON text", () => {
    const data = { items: [{ id: "a" }], total: 1 };
    expect(structuredResult(data)).toEqual({ content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data, isError: false });
  });

  it("builds tool execution errors with the fixed messages", () => {
    expect(toolError(NOT_FOUND_MESSAGE)).toEqual({ content: [{ type: "text", text: "Not found." }], isError: true });
    expect(INTERNAL_ERROR_MESSAGE).toBe("Internal error.");
  });
});

describe("resource URIs", () => {
  it("names documents and comment files of a request", () => {
    expect(requestDocumentUri("r1", "a1")).toBe("serviceflow://requests/r1/documents/a1");
    expect(commentFileUri("r1", "c1", "f1")).toBe("serviceflow://requests/r1/comments/c1/files/f1");
  });

  it("encodes identifiers that are not URI-safe", () => {
    expect(requestDocumentUri("a/b", "c d")).toBe("serviceflow://requests/a%2Fb/documents/c%20d");
  });
});
