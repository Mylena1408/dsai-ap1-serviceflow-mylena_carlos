import type { DetectedDocumentFormat } from "@/modules/attachments";

/** Attachment metadata shown to authorized users; never carries the storage key (SPEC 21.5). */
export interface RequestAttachmentSummary {
  id: string;
  requirementNameSnapshot: string;
  requirementRequiredSnapshot: boolean;
  originalFilename: string;
  detectedFormat: DetectedDocumentFormat;
  sizeBytes: number;
  createdAt: Date;
}

/** Server-only fields needed to serve the content. */
export interface StoredRequestAttachment extends RequestAttachmentSummary {
  contentType: string;
  sha256: string;
  storageKey: string;
}

export interface AttachmentDownload {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

// Characters that cannot appear inside a quoted header value or outside ASCII.
const UNSAFE_HEADER_FILENAME = /[^\x20-\x7e]|["\\%;]/g;

/**
 * `Content-Disposition: attachment` with an ASCII fallback and the UTF-8 name in
 * `filename*` (RFC 6266). The stored name is already sanitized (SPEC 21.6, 21.9).
 */
export function buildAttachmentContentDisposition(filename: string): string {
  const fallback = filename.replace(UNSAFE_HEADER_FILENAME, "_");
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
