import type { PrismaClient } from "@prisma/client";
import { getCommentFileDownload, listComments } from "@/modules/comments";
import { listRequestsAsCaller, type ApiCaller } from "@/modules/public-api";
import { getAttachmentDownload, listRequestAttachments } from "@/modules/requests";
import type { DocumentStorage } from "@/server/storage";
import type { McpToolOperations } from "../application/ports";

// Binds the MCP tools to the operations the screens and the API already use (SPEC
// 2026-11-05-mcp-documentos, 2 and 5.4): the same authorization runs, with the token owner as the
// current user, and files come through the same server-side download with its integrity check.

export interface McpInfrastructure {
  database: PrismaClient;
  storage: DocumentStorage;
}

export function createMcpToolOperations(caller: ApiCaller, now: Date, infrastructure: McpInfrastructure): McpToolOperations {
  const { database, storage } = infrastructure;

  return {
    async findRequests(query) {
      return (await listRequestsAsCaller(caller, query, now)) as Record<string, unknown>;
    },
    listRequestAttachments(requestId) {
      return listRequestAttachments(requestId, database);
    },
    listComments(requestId) {
      return listComments(requestId, database);
    },
    readRequestDocument(requestId, attachmentId) {
      return getAttachmentDownload(requestId, attachmentId, database, storage);
    },
    readCommentFile(requestId, commentId, fileId) {
      return getCommentFileDownload({ requestId, commentId, fileId }, database, storage);
    },
  };
}
