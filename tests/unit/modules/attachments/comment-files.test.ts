import { describe, expect, it } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { assertCommentFileLimits, inspectCommentFile } from "@/modules/attachments";
import { assertCanAddLateDocument, type LateDocumentContext } from "@/modules/requests/domain/attachment-requirements";
import { minimalDocx, minimalPdf, syntheticText, windowsExecutable } from "./synthetic-files";

// SPEC 2026-11-03-anexos-comentarios-documentos, 5.1 and 5.3 (SF-124).

const MiB = 1024 * 1024;

function refusal(work: () => unknown) {
  try {
    work();
  } catch (error) {
    return error;
  }
  return null;
}

describe("limits of comment files (5.1, decision X1)", () => {
  it("accepts up to 3 files of 2 MiB, 4 MiB together, within 30 per request", () => {
    expect(() => assertCommentFileLimits([{ size: MiB }, { size: MiB }, { size: 2 * MiB }], 0)).not.toThrow();
    expect(() => assertCommentFileLimits([{ size: 10 }], 29)).not.toThrow();
    expect(() => assertCommentFileLimits([], 30)).not.toThrow();
  });

  it("refuses more files, bigger or empty files, a bigger sum or the 31st file of the request, on the file field", () => {
    for (const [uploads, existing] of [
      [[{ size: 1 }, { size: 1 }, { size: 1 }, { size: 1 }], 0],
      [[{ size: 2 * MiB + 1 }], 0],
      [[{ size: 0 }], 0],
      [[{ size: 2 * MiB }, { size: 2 * MiB }, { size: 1 }], 0],
      [[{ size: 1 }, { size: 1 }], 29],
    ] as const) {
      const error = refusal(() => assertCommentFileLimits(uploads, existing));
      expect(error, JSON.stringify(uploads)).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).issues[0]?.path).toEqual(["attachments"]);
    }
  });

  it("detects the format by the content and keeps the server-derived metadata (decision X2)", () => {
    expect(inspectCommentFile({ name: "laudo.pdf", bytes: minimalPdf() })).toMatchObject({ detectedFormat: "PDF", contentType: "application/pdf" });
    expect(inspectCommentFile({ name: "ata.docx", bytes: minimalDocx() }).detectedFormat).toBe("DOCX");
    expect(inspectCommentFile({ name: "nota.txt", bytes: syntheticText() }).detectedFormat).toBe("TXT");
    expect(() => inspectCommentFile({ name: "foto.pdf", bytes: windowsExecutable() })).toThrow(ValidationError);
    expect(() => inspectCommentFile({ name: "laudo.txt", bytes: minimalPdf() })).toThrow(ValidationError);
  });
});

describe("document sent after the opening (5.3)", () => {
  const requirement = { id: "req-1", name: "Comprovante", isRequired: false, acceptedFormats: ["PDF" as const] };
  const base: LateDocumentContext = {
    actor: { id: "rita", role: "REQUESTER", isActive: true },
    request: { requesterId: "rita", status: "OPEN" },
    requirement,
    documents: [{ requirementId: "req-2", sizeBytes: MiB }],
    size: MiB,
  };

  it("lets the owner send a missing document while the request is open or in progress", () => {
    expect(assertCanAddLateDocument(base)).toBe(requirement);
    expect(assertCanAddLateDocument({ ...base, request: { ...base.request, status: "IN_PROGRESS" } })).toBe(requirement);
  });

  it("hides the action from anyone but the owner and refuses finished requests", () => {
    for (const actor of [
      { id: "diego", role: "ATTENDANT", isActive: true },
      { id: "bruno", role: "REQUESTER", isActive: true },
      { id: "rita", role: "REQUESTER", isActive: false },
    ]) {
      expect(() => assertCanAddLateDocument({ ...base, actor }), actor.id).toThrow(NotFoundError);
    }
    for (const status of ["COMPLETED", "CANCELLED"] as const) {
      expect(() => assertCanAddLateDocument({ ...base, request: { ...base.request, status } })).toThrow(ConflictError);
    }
  });

  it("refuses a requirement already met, inactive or of another service, and the limits of the request", () => {
    expect(() => assertCanAddLateDocument({ ...base, documents: [{ requirementId: "req-1", sizeBytes: 10 }] })).toThrow(ValidationError);
    expect(() => assertCanAddLateDocument({ ...base, requirement: null })).toThrow(ValidationError);
    expect(() => assertCanAddLateDocument({ ...base, documents: [{ requirementId: "req-2", sizeBytes: 3 * MiB }], size: MiB + 1 })).toThrow(ValidationError);
    const five = ["a", "b", "c", "d", "e"].map((requirementId) => ({ requirementId, sizeBytes: 10 }));
    expect(() => assertCanAddLateDocument({ ...base, documents: five, size: 10 })).toThrow(ValidationError);
  });
});
