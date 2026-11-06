// Tool results (SPEC 2026-11-05-mcp-documentos, 5.4 items 5 to 8): text for TXT, a base64
// embedded resource for PDF and DOCX, structured content for listings, and the fixed messages of
// the refusals. Nothing here logs or echoes arguments.

export const NOT_FOUND_MESSAGE = "Not found.";
export const INTERNAL_ERROR_MESSAGE = "Internal error.";

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "resource"; resource: { uri: string; mimeType: string; blob: string } };

export interface ToolResult {
  content: ContentBlock[];
  structuredContent?: Record<string, unknown>;
  isError: boolean;
}

export interface FileContent {
  uri: string;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

export function toolError(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Structured result plus its JSON in a text block, as the tools page asks for compatibility. */
export function structuredResult(data: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data, isError: false };
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MiB`;
}

const TEXT_CONTENT_TYPE = /^text\/plain(;|$)/i;

/**
 * Content of a read file. TXT is already valid UTF-8 (checked when the file was sent), so it is
 * decoded strictly; anything that still fails to decode is sent as base64 instead of mangled text.
 */
export function fileResult(file: FileContent): ToolResult {
  const summary: ContentBlock = {
    type: "text",
    text: `File "${file.filename}" (${file.contentType}, ${formatBytes(file.bytes.length)}).`,
  };

  if (TEXT_CONTENT_TYPE.test(file.contentType)) {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
      return { content: [summary, { type: "text", text }], isError: false };
    } catch {
      // Falls through to the embedded resource.
    }
  }

  return {
    content: [
      summary,
      { type: "resource", resource: { uri: file.uri, mimeType: file.contentType, blob: Buffer.from(file.bytes).toString("base64") } },
    ],
    isError: false,
  };
}

export function requestDocumentUri(requestId: string, attachmentId: string): string {
  return `serviceflow://requests/${encodeURIComponent(requestId)}/documents/${encodeURIComponent(attachmentId)}`;
}

export function commentFileUri(requestId: string, commentId: string, fileId: string): string {
  return (
    `serviceflow://requests/${encodeURIComponent(requestId)}/comments/${encodeURIComponent(commentId)}` +
    `/files/${encodeURIComponent(fileId)}`
  );
}
