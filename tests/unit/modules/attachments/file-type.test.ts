import { describe, expect, it } from "vitest";
import {
  DOCX_MAX_CONTENT_TYPES_BYTES,
  DOCX_MAX_ZIP_ENTRIES,
  detectDocumentFormat,
} from "@/modules/attachments/file-type";
import {
  buildZip,
  macroEnabledDocx,
  minimalDocx,
  minimalPdf,
  plainZip,
  syntheticText,
  windowsExecutable,
} from "./synthetic-files";

const encode = (text: string) => new TextEncoder().encode(text);

describe("document format detection", () => {
  it("detects PDF by the %PDF- signature", () => {
    expect(detectDocumentFormat(minimalPdf())).toBe("PDF");
  });

  it("detects a macro-free Word document", () => {
    expect(detectDocumentFormat(minimalDocx())).toBe("DOCX");
  });

  it("detects a stored (uncompressed) Word document", () => {
    const stored = buildZip([
      {
        name: "[Content_Types].xml",
        store: true,
        content:
          '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      },
      { name: "word/document.xml", store: true, content: "<w:document/>" },
    ]);

    expect(detectDocumentFormat(stored)).toBe("DOCX");
  });

  it("detects UTF-8 text with tabs, CR/LF and an optional BOM", () => {
    expect(detectDocumentFormat(syntheticText())).toBe("TXT");
    expect(detectDocumentFormat(new Uint8Array([0xef, 0xbb, 0xbf, ...encode("Olá, mundo")]))).toBe(
      "TXT",
    );
  });

  it("rejects macro-enabled Word documents", () => {
    expect(detectDocumentFormat(macroEnabledDocx())).toBeNull();
  });

  it("rejects a Word package that only adds a VBA project", () => {
    const withVba = buildZip([
      {
        name: "[Content_Types].xml",
        content:
          '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      },
      { name: "word/document.xml", content: "<w:document/>" },
      { name: "word/vbaProject.bin", content: new Uint8Array([1, 2, 3]) },
    ]);

    expect(detectDocumentFormat(withVba)).toBeNull();
  });

  it("rejects ZIP archives that are not Word documents", () => {
    expect(detectDocumentFormat(plainZip())).toBeNull();
    expect(
      detectDocumentFormat(
        buildZip([
          { name: "[Content_Types].xml", content: "<Types/>" },
          { name: "word/document.xml", content: "<w:document/>" },
        ]),
      ),
    ).toBeNull();
  });

  it("rejects a truncated or corrupted ZIP", () => {
    const docx = minimalDocx();

    expect(detectDocumentFormat(docx.subarray(0, docx.length - 10))).toBeNull();

    const corrupted = new Uint8Array(docx);
    corrupted.fill(0xff, 30, 60);
    expect(detectDocumentFormat(corrupted)).toBeNull();
  });

  it("limits the number of ZIP entries", () => {
    const entries = Array.from({ length: DOCX_MAX_ZIP_ENTRIES + 1 }, (_, index) => ({
      name: `word/media/item-${index}.xml`,
      content: "x",
      store: true,
    }));

    expect(detectDocumentFormat(buildZip(entries))).toBeNull();
  });

  it("refuses to inflate an oversized content types part", () => {
    const oversized = buildZip([
      {
        name: "[Content_Types].xml",
        content: `<Types>${" ".repeat(DOCX_MAX_CONTENT_TYPES_BYTES + 1)}</Types>`,
      },
      { name: "word/document.xml", content: "<w:document/>" },
    ]);

    expect(detectDocumentFormat(oversized)).toBeNull();
  });

  it.each([
    ["null bytes", new Uint8Array([0x61, 0x00, 0x62])],
    ["invalid UTF-8", new Uint8Array([0x61, 0xc3, 0x28])],
    ["control characters", encode("abc\u0007def")],
    ["DEL", encode("abc\u007f")],
    ["C1 controls", encode("abc\u0085")],
    ["a Windows executable", windowsExecutable()],
  ])("rejects %s as text", (_label, bytes) => {
    expect(detectDocumentFormat(bytes)).toBeNull();
  });

  it("rejects empty content", () => {
    expect(detectDocumentFormat(new Uint8Array())).toBeNull();
  });
});
