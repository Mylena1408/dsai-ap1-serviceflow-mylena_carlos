import type { CommentRecord } from "@/modules/comments";
import type { RequestAttachmentSummary } from "@/modules/requests";

// What the MCP tools need from the rest of the application (SPEC 2026-11-05-mcp-documentos, 5.4).
// Every operation runs as the token owner and applies the same checks as the screens; the
// infrastructure binds them to the existing modules.

export type ListQuery = Record<string, string | string[] | undefined>;

export interface FileDownload {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface McpToolOperations {
  /** Same operation as `GET /api/v1/requests`; returns its page body. */
  findRequests(query: ListQuery): Promise<Record<string, unknown>>;
  listRequestAttachments(requestId: string): Promise<RequestAttachmentSummary[]>;
  listComments(requestId: string): Promise<CommentRecord[]>;
  readRequestDocument(requestId: string, attachmentId: string): Promise<FileDownload>;
  readCommentFile(requestId: string, commentId: string, fileId: string): Promise<FileDownload>;
}

/** Token owners are never administrators (API SPEC), but the type is the one of the token owner. */
export type McpCallerRole = "ADMIN" | "REQUESTER" | "ATTENDANT" | "MANAGER";

export interface McpCaller {
  role: McpCallerRole;
}
