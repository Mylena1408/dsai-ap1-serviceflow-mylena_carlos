import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_REQUEST,
  MAX_ATTACHMENTS_TOTAL_BYTES,
  assertAttachmentBatchLimits,
  buildAttachmentStorageKey,
  getFilenameFormat,
  inspectAttachment,
  sanitizeAttachmentFilename,
} from "@/modules/attachments/domain/attachment-policy";
import { ValidationError, toErrorResponse } from "@/server/errors";
import {
  macroEnabledDocx,
  minimalDocx,
  minimalPdf,
  plainZip,
  syntheticText,
  windowsExecutable,
} from "./synthetic-files";

const ALL_FORMATS = ["PDF", "DOCX", "TXT"] as const;
const REQUEST_ID = "6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4";
const ATTACHMENT_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

function captureError(action: () => unknown): ValidationError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return error as ValidationError;
  }

  throw new Error("Expected a validation error.");
}

describe("attachment limits", () => {
  it("documents the SPEC 21.6 values", () => {
    expect(MAX_ATTACHMENTS_PER_REQUEST).toBe(5);
    expect(MAX_ATTACHMENT_BYTES).toBe(2_097_152);
    expect(MAX_ATTACHMENTS_TOTAL_BYTES).toBe(4_194_304);
  });

  it("accepts five files within the per-file and total limits", () => {
    expect(() =>
      assertAttachmentBatchLimits([
        { size: MAX_ATTACHMENT_BYTES },
        { size: MAX_ATTACHMENT_BYTES },
      ]),
    ).not.toThrow();
    expect(() => assertAttachmentBatchLimits(Array(5).fill({ size: 1 }))).not.toThrow();
  });

  it.each([
    ["more than five files", Array(6).fill({ size: 1 }), "too_big"],
    ["an empty file", [{ size: 0 }], "too_small"],
    ["a file above 2 MiB", [{ size: MAX_ATTACHMENT_BYTES + 1 }], "too_big"],
    [
      "a total above 4 MiB",
      [{ size: MAX_ATTACHMENT_BYTES }, { size: MAX_ATTACHMENT_BYTES }, { size: 1 }],
      "too_big",
    ],
  ])("rejects %s", (_label, uploads, code) => {
    const error = captureError(() => assertAttachmentBatchLimits(uploads));

    expect(error.issues).toEqual([{ path: ["attachments"], code }]);
  });
});

describe("attachment filename sanitization", () => {
  it("keeps only the base name and removes control and bidirectional characters", () => {
    expect(sanitizeAttachmentFilename("C:\\fakepath\\Requerimento.pdf")).toBe("Requerimento.pdf");
    expect(sanitizeAttachmentFilename("../../etc/escala.txt")).toBe("escala.txt");
    expect(sanitizeAttachmentFilename("  form\u0000ulario\n  final .docx ")).toBe(
      "formulario final .docx",
    );
    expect(sanitizeAttachmentFilename("fatura\u202Etxt.exe")).toBe("faturatxt.exe");
  });

  it("normalizes Unicode to NFC", () => {
    expect(sanitizeAttachmentFilename("fe\u0301rias.pdf")).toBe("f\u00e9rias.pdf");
  });

  it("accepts 255 characters and rejects longer names instead of truncating", () => {
    const exact = `${"a".repeat(251)}.pdf`;

    expect(sanitizeAttachmentFilename(exact)).toBe(exact);
    expect(captureError(() => sanitizeAttachmentFilename(`a${exact}`)).issues[0].code).toBe(
      "too_big",
    );
  });

  it.each(["", "   ", "\u0000\u0001", "folder/", ".."])("rejects the empty name %j", (name) => {
    expect(captureError(() => sanitizeAttachmentFilename(name)).issues[0].code).toBe(
      "invalid_value",
    );
  });

  it("maps extensions case-insensitively", () => {
    expect(getFilenameFormat("A.PDF")).toBe("PDF");
    expect(getFilenameFormat("b.Docx")).toBe("DOCX");
    expect(getFilenameFormat("c.txt")).toBe("TXT");
    expect(getFilenameFormat("d.docm")).toBeNull();
    expect(getFilenameFormat(".pdf")).toBeNull();
    expect(getFilenameFormat("sem-extensao")).toBeNull();
  });
});

describe("attachment inspection", () => {
  it.each([
    ["requerimento.pdf", minimalPdf(), "PDF", "application/pdf"],
    [
      "formulario.docx",
      minimalDocx(),
      "DOCX",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    ["declaracao.txt", syntheticText(), "TXT", "text/plain"],
  ])("accepts a valid %s and derives metadata on the server", (name, bytes, format, contentType) => {
    const inspected = inspectAttachment({ name, bytes }, ALL_FORMATS);

    expect(inspected).toEqual({
      originalFilename: name,
      detectedFormat: format,
      contentType,
      sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    expect(inspected.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a valid file whose format the requirement does not accept", () => {
    const error = captureError(() =>
      inspectAttachment({ name: "requerimento.pdf", bytes: minimalPdf() }, ["DOCX", "TXT"]),
    );

    expect(error.issues[0].code).toBe("invalid_format");
  });

  it.each([
    ["an executable renamed to .pdf", "documento.pdf", windowsExecutable()],
    ["a .docm renamed to .docx", "documento.docx", macroEnabledDocx()],
    ["a binary renamed to .txt", "documento.txt", new Uint8Array([0x00, 0x01, 0x02, 0xff])],
    ["a plain ZIP renamed to .docx", "documento.docx", plainZip()],
    ["a PDF renamed to .txt", "documento.txt", minimalPdf()],
    ["a text file renamed to .pdf", "documento.pdf", syntheticText()],
    ["a file without a supported extension", "documento.exe", minimalPdf()],
  ])("rejects %s (CA-DOC-10)", (_label, name, bytes) => {
    const error = captureError(() => inspectAttachment({ name, bytes }, ALL_FORMATS));

    expect(error.issues[0].code).toBe("invalid_format");
  });

  it("rejects empty and oversized files before reading their content", () => {
    expect(
      captureError(() =>
        inspectAttachment({ name: "vazio.txt", bytes: new Uint8Array() }, ALL_FORMATS),
      ).issues[0].code,
    ).toBe("too_small");

    const oversized = new Uint8Array(MAX_ATTACHMENT_BYTES + 1).fill(0x61);

    expect(
      captureError(() => inspectAttachment({ name: "grande.txt", bytes: oversized }, ALL_FORMATS))
        .issues[0].code,
    ).toBe("too_big");
  });

  it("never exposes the file name or content in public errors (CA-DOC-20)", () => {
    const secretName = "cpf-12345678900-joao.pdf";
    const secretContent = "CONTEUDO-CONFIDENCIAL-SINTETICO";
    const error = captureError(() =>
      inspectAttachment({ name: secretName, bytes: new TextEncoder().encode(secretContent) }, ALL_FORMATS),
    );
    const exposed = JSON.stringify(toErrorResponse(error)) + error.message;

    expect(toErrorResponse(error).body.error.issues).toEqual([
      { path: ["attachments"], code: "invalid_format" },
    ]);
    expect(exposed).not.toContain("cpf");
    expect(exposed).not.toContain("joao");
    expect(exposed).not.toContain(secretContent);
  });
});

describe("attachment storage keys", () => {
  it("builds an opaque key from server-generated identifiers only", () => {
    expect(buildAttachmentStorageKey(REQUEST_ID, ATTACHMENT_ID)).toBe(
      `requests/${REQUEST_ID}/${ATTACHMENT_ID}`,
    );
  });

  it.each([
    ["../outro", ATTACHMENT_ID],
    [REQUEST_ID, "requerimento.pdf"],
    [`${REQUEST_ID}/x`, ATTACHMENT_ID],
  ])("rejects identifiers that are not UUIDs (%s, %s)", (requestId, attachmentId) => {
    expect(() => buildAttachmentStorageKey(requestId, attachmentId)).toThrow(ValidationError);
  });
});
