// Attachment validation has no persistence yet (SF-034/SF-035 will add it), so the
// module only has a domain layer (SPEC 2026-10-27, section 5.1).
export {
  DOCUMENT_CONTENT_TYPES,
  MAX_ATTACHMENTS_PER_REQUEST,
  MAX_ATTACHMENTS_TOTAL_BYTES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_FILENAME_LENGTH,
  assertAttachmentBatchLimits,
  buildAttachmentStorageKey,
  getFilenameFormat,
  inspectAttachment,
  isAttachmentStorageKey,
  sanitizeAttachmentFilename,
  sha256Hex,
} from "./domain/attachment-policy";
export type { AttachmentUpload, InspectedAttachment } from "./domain/attachment-policy";
export {
  DOCX_MAX_CONTENT_TYPES_BYTES,
  DOCX_MAX_ZIP_ENTRIES,
  detectDocumentFormat,
} from "./domain/file-type";
export type { DetectedDocumentFormat } from "./domain/file-type";
