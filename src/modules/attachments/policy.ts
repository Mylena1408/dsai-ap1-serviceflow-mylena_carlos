import { createHash } from "node:crypto";
import { ValidationError } from "@/server/errors";
import { detectDocumentFormat, type DetectedDocumentFormat } from "./file-type";

// Limits from SPEC 21.6. The server is the source of truth; the interface only mirrors them.
export const MAX_ATTACHMENTS_PER_REQUEST = 5;
export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
export const MAX_ATTACHMENTS_TOTAL_BYTES = 4 * 1024 * 1024;
export const MAX_ATTACHMENT_FILENAME_LENGTH = 255;

export const DOCUMENT_CONTENT_TYPES: Record<DetectedDocumentFormat, string> = {
  PDF: "application/pdf",
  DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  TXT: "text/plain",
};

const EXTENSION_FORMATS: Record<string, DetectedDocumentFormat> = {
  pdf: "PDF",
  docx: "DOCX",
  txt: "TXT",
};

const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const STORAGE_KEY_PATTERN = new RegExp(`^requests/${UUID_PATTERN}/${UUID_PATTERN}$`);

// C0/C1 controls, DEL and bidirectional overrides that could disguise the real extension.
const UNSAFE_FILENAME_CHARACTERS = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

export interface AttachmentUpload {
  name: string;
  bytes: Uint8Array;
}

export interface InspectedAttachment {
  originalFilename: string;
  detectedFormat: DetectedDocumentFormat;
  contentType: string;
  sizeBytes: number;
  sha256: string;
}

// Messages are fixed and never echo file names or content (SPEC 21.4, 21.10).
function attachmentError(code: "too_big" | "too_small" | "invalid_format" | "invalid_value") {
  return new ValidationError([{ path: ["attachments"], code }]);
}

export function sanitizeAttachmentFilename(rawName: string): string {
  const baseName = rawName.normalize("NFC").split(/[/\\]/).pop() ?? "";
  const sanitized = baseName
    .replace(UNSAFE_FILENAME_CHARACTERS, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!sanitized || sanitized === "." || sanitized === "..") {
    throw attachmentError("invalid_value");
  }

  if ([...sanitized].length > MAX_ATTACHMENT_FILENAME_LENGTH) {
    throw attachmentError("too_big");
  }

  return sanitized;
}

export function getFilenameFormat(filename: string): DetectedDocumentFormat | null {
  const dotIndex = filename.lastIndexOf(".");

  if (dotIndex <= 0) {
    return null;
  }

  return EXTENSION_FORMATS[filename.slice(dotIndex + 1).toLowerCase()] ?? null;
}

export function assertAttachmentBatchLimits(uploads: Array<{ size: number }>): void {
  if (uploads.length > MAX_ATTACHMENTS_PER_REQUEST) {
    throw attachmentError("too_big");
  }

  let totalBytes = 0;

  for (const { size } of uploads) {
    if (size <= 0) {
      throw attachmentError("too_small");
    }

    if (size > MAX_ATTACHMENT_BYTES) {
      throw attachmentError("too_big");
    }

    totalBytes += size;
  }

  if (totalBytes > MAX_ATTACHMENTS_TOTAL_BYTES) {
    throw attachmentError("too_big");
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// Validates one file against the formats accepted by its requirement and derives every
// stored metadata field on the server (SPEC 21.4 item 8, 21.7, 21.9).
export function inspectAttachment(
  upload: AttachmentUpload,
  acceptedFormats: readonly DetectedDocumentFormat[],
): InspectedAttachment {
  assertAttachmentBatchLimits([{ size: upload.bytes.length }]);

  const originalFilename = sanitizeAttachmentFilename(upload.name);
  const extensionFormat = getFilenameFormat(originalFilename);
  const detectedFormat = detectDocumentFormat(upload.bytes);

  if (!extensionFormat || !detectedFormat || extensionFormat !== detectedFormat) {
    throw attachmentError("invalid_format");
  }

  if (!acceptedFormats.includes(detectedFormat)) {
    throw attachmentError("invalid_format");
  }

  return {
    originalFilename,
    detectedFormat,
    contentType: DOCUMENT_CONTENT_TYPES[detectedFormat],
    sizeBytes: upload.bytes.length,
    sha256: sha256Hex(upload.bytes),
  };
}

// Opaque key built only from server-generated identifiers (SPEC 21.15.4); matches the
// RequestAttachment_storageKey_check constraint.
export function buildAttachmentStorageKey(requestId: string, attachmentId: string): string {
  const key = `requests/${requestId.toLowerCase()}/${attachmentId.toLowerCase()}`;

  if (!STORAGE_KEY_PATTERN.test(key)) {
    throw attachmentError("invalid_value");
  }

  return key;
}

export function isAttachmentStorageKey(key: string): boolean {
  return STORAGE_KEY_PATTERN.test(key);
}
