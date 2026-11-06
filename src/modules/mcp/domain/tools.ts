import { z } from "zod";

// The four read-only tools (SPEC 2026-11-05-mcp-documentos, 5.4): what `tools/list` announces and
// the strict schemas that check `tools/call` arguments. The JSON Schemas below and the zod schemas
// describe the same objects; a unit test keeps their property names and required lists equal.

export const TOOL_NAMES = ["find_requests", "list_request_documents", "read_request_document", "read_comment_file"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const REQUEST_STATUSES = ["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
export const MANAGER_FILTERS = ["pending", "all", "sector"] as const;

const MAX_ID_LENGTH = 100;
const MAX_QUERY_LENGTH = 200;
const MAX_PAGE = 10_000;

// Identifiers are only bounded here: a malformed id reaches the use case, which answers "not
// found" exactly as for an id that does not exist (5.4 item 6).
const identifier = z.string().min(1).max(MAX_ID_LENGTH);

export const toolArgumentSchemas = {
  find_requests: z
    .object({
      q: z.string().max(MAX_QUERY_LENGTH).optional(),
      status: z.array(z.enum(REQUEST_STATUSES)).min(1).max(REQUEST_STATUSES.length).optional(),
      page: z.number().int().min(1).max(MAX_PAGE).optional(),
      filter: z.enum(MANAGER_FILTERS).optional(),
    })
    .strict(),
  list_request_documents: z.object({ requestId: identifier }).strict(),
  read_request_document: z.object({ requestId: identifier, attachmentId: identifier }).strict(),
  read_comment_file: z.object({ requestId: identifier, commentId: identifier, fileId: identifier }).strict(),
} as const;

export type ToolArguments = { [Name in ToolName]: z.infer<(typeof toolArgumentSchemas)[Name]> };

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const idProperty = (description: string) => ({ type: "string", description, maxLength: MAX_ID_LENGTH });

export interface ToolDefinition {
  name: ToolName;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: typeof READ_ONLY;
}

/** Fixed order, so clients can cache the list (deterministic `tools/list`). */
export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: "find_requests",
    title: "Find requests",
    description:
      "Lists ServiceFlow requests the token owner can see: a requester sees their own requests, an attendant " +
      "the queue of their sector, a manager the approvals of their sector. Returns one page (newest first by " +
      "default) with ids to use in the other tools.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Text to search in the description or service name.", maxLength: MAX_QUERY_LENGTH },
        status: {
          type: "array",
          description: "Only requests in these statuses.",
          items: { type: "string", enum: [...REQUEST_STATUSES] },
          minItems: 1,
          maxItems: REQUEST_STATUSES.length,
        },
        page: { type: "integer", description: "Page number, starting at 1.", minimum: 1, maximum: MAX_PAGE },
        filter: {
          type: "string",
          description: "Managers only: pending approvals (default), all approvals, or the whole sector.",
          enum: [...MANAGER_FILTERS],
        },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "list_request_documents",
    title: "List request documents",
    description:
      "Lists the documents of a request (sent when it was opened or later) and the files attached to the " +
      "comments the token owner can see, with ids, names, formats and sizes. Read a file with " +
      "read_request_document or read_comment_file.",
    inputSchema: {
      type: "object",
      properties: { requestId: idProperty("Request id (UUID).") },
      required: ["requestId"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "read_request_document",
    title: "Read request document",
    description:
      "Returns one document of a request. TXT comes back as text; PDF and DOCX come back as a base64 embedded " +
      "resource (up to 2 MiB, about 2.7 MB of base64). Check the size in list_request_documents first.",
    inputSchema: {
      type: "object",
      properties: {
        requestId: idProperty("Request id (UUID)."),
        attachmentId: idProperty("Document id from list_request_documents."),
      },
      required: ["requestId", "attachmentId"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "read_comment_file",
    title: "Read comment file",
    description:
      "Returns one file attached to a comment of a request. TXT comes back as text; PDF and DOCX come back as a " +
      "base64 embedded resource (up to 2 MiB).",
    inputSchema: {
      type: "object",
      properties: {
        requestId: idProperty("Request id (UUID)."),
        commentId: idProperty("Comment id from list_request_documents."),
        fileId: idProperty("File id from list_request_documents."),
      },
      required: ["requestId", "commentId", "fileId"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
];

export function isToolName(value: unknown): value is ToolName {
  return typeof value === "string" && (TOOL_NAMES as readonly string[]).includes(value);
}

export type ArgumentCheck<Name extends ToolName> = { ok: true; value: ToolArguments[Name] } | { ok: false; message: string };

/**
 * Checks the arguments of a call. A refusal names each offending field and the kind of problem,
 * so the model can correct the call (tool execution error, 5.4); values are never echoed.
 */
export function checkToolArguments<Name extends ToolName>(name: Name, input: unknown): ArgumentCheck<Name> {
  const result = toolArgumentSchemas[name].safeParse(input ?? {});
  if (result.success) return { ok: true, value: result.data as ToolArguments[Name] };

  const problems = result.error.issues.map((issue) => {
    if (issue.code === "unrecognized_keys") return `unknown field(s): ${issue.keys.join(", ")}`;
    const field = issue.path.length > 0 ? issue.path.map(String).join(".") : "arguments";
    return `${field}: ${issueKind(issue.code, issue.message)}`;
  });
  return { ok: false, message: `Invalid arguments. ${[...new Set(problems)].join("; ")}.` };
}

function issueKind(code: string, message: string): string {
  switch (code) {
    case "invalid_type":
      return message.includes("received undefined") ? "required" : "wrong type";
    case "too_small":
      return "too small or too short";
    case "too_big":
      return "too large or too long";
    case "invalid_value":
      return "not an accepted value";
    default:
      return "invalid";
  }
}
