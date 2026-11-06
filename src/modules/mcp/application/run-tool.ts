import { ApplicationError, InternalServerError, ValidationError } from "@/server/errors";
import {
  INTERNAL_ERROR_MESSAGE,
  NOT_FOUND_MESSAGE,
  commentFileUri,
  fileResult,
  requestDocumentUri,
  structuredResult,
  toolError,
  type ToolResult,
} from "../domain/content";
import { checkToolArguments, type ToolArguments, type ToolName } from "../domain/tools";
import type { ListQuery, McpCaller, McpToolOperations } from "./ports";

// Execution of one tool call (SPEC 2026-11-05-mcp-documentos, 5.4). Refusals of the use cases
// become tool execution errors: whatever the caller cannot see answers "Not found." (item 6), and
// an unexpected failure answers "Internal error." with only the error name in the log (item 8).

/** The manager does not see comments on the screens, so their files are not listed (5.4 item 2). */
export const MANAGER_COMMENT_FILES_NOTE = "Managers do not see comments, so comment files are not listed.";

function iso(value: Date): string {
  return value.toISOString();
}

function findQuery(args: ToolArguments["find_requests"]): ListQuery {
  return {
    q: args.q,
    status: args.status,
    page: args.page === undefined ? undefined : String(args.page),
    filter: args.filter,
  };
}

async function listDocuments(caller: McpCaller, requestId: string, operations: McpToolOperations): Promise<ToolResult> {
  // The attachment read is authorized first; for a request the caller cannot see it fails before
  // the comments are read, so nothing else runs.
  const attachments = await operations.listRequestAttachments(requestId);
  const comments = caller.role === "MANAGER" ? null : await operations.listComments(requestId);

  const documents = attachments.map((attachment) => ({
    id: attachment.id,
    requirement: attachment.requirementNameSnapshot,
    required: attachment.requirementRequiredSnapshot,
    fileName: attachment.removedAt ? null : attachment.originalFilename,
    format: attachment.detectedFormat,
    sizeBytes: attachment.sizeBytes,
    sentAt: iso(attachment.createdAt),
    removed: Boolean(attachment.removedAt),
  }));
  const commentFiles = (comments ?? []).flatMap((comment) =>
    (comment.files ?? []).map((file) => ({
      commentId: comment.id,
      fileId: file.id,
      internalNote: comment.isInternal,
      commentedAt: iso(comment.createdAt),
      fileName: file.removed ? null : file.originalFilename,
      format: file.detectedFormat,
      sizeBytes: file.sizeBytes,
      removed: file.removed,
    })),
  );

  return structuredResult({
    requestId,
    documents,
    commentFiles,
    ...(comments === null ? { commentFilesNote: MANAGER_COMMENT_FILES_NOTE } : {}),
  });
}

async function execute(name: ToolName, args: unknown, caller: McpCaller, operations: McpToolOperations): Promise<ToolResult> {
  switch (name) {
    case "find_requests": {
      const checked = checkToolArguments("find_requests", args);
      if (!checked.ok) return toolError(checked.message);
      return structuredResult(await operations.findRequests(findQuery(checked.value)));
    }
    case "list_request_documents": {
      const checked = checkToolArguments("list_request_documents", args);
      if (!checked.ok) return toolError(checked.message);
      return listDocuments(caller, checked.value.requestId, operations);
    }
    case "read_request_document": {
      const checked = checkToolArguments("read_request_document", args);
      if (!checked.ok) return toolError(checked.message);
      const { requestId, attachmentId } = checked.value;
      const file = await operations.readRequestDocument(requestId, attachmentId);
      return fileResult({ ...file, uri: requestDocumentUri(requestId, attachmentId) });
    }
    case "read_comment_file": {
      const checked = checkToolArguments("read_comment_file", args);
      if (!checked.ok) return toolError(checked.message);
      const { requestId, commentId, fileId } = checked.value;
      const file = await operations.readCommentFile(requestId, commentId, fileId);
      return fileResult({ ...file, uri: commentFileUri(requestId, commentId, fileId) });
    }
  }
}

function refusal(name: ToolName, error: unknown): ToolResult {
  if (error instanceof ApplicationError && !(error instanceof InternalServerError)) {
    // Only the listing takes free filters whose refusal the model can fix; for the other tools a
    // refused id is indistinguishable from a missing one.
    if (name === "find_requests" && error instanceof ValidationError) {
      const fields = [...new Set(error.issues.map(({ path }) => path.join(".") || "arguments"))];
      return toolError(`Invalid arguments. ${fields.join(", ")}: not accepted.`);
    }
    return toolError(NOT_FOUND_MESSAGE);
  }

  console.error("Unexpected error in an MCP tool.", error instanceof Error ? error.name : "unknown");
  return toolError(INTERNAL_ERROR_MESSAGE);
}

export async function runTool(
  name: ToolName,
  args: unknown,
  caller: McpCaller,
  operations: McpToolOperations,
): Promise<ToolResult> {
  try {
    return await execute(name, args, caller, operations);
  } catch (error) {
    return refusal(name, error);
  }
}
