import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import { getApplicationDocumentStorage, type DocumentStorage } from "@/server/storage";
import { handleMcpPost, methodNotAllowed } from "./infrastructure/http";

// Public API of the MCP module (SPEC 2026-11-05-mcp-documentos). The route file only points at
// these handlers; tests pass their own database and storage.

export {
  LEGACY_PROTOCOL_VERSIONS,
  MODERN_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "./domain/protocol";
export { TOOL_DEFINITIONS, TOOL_NAMES } from "./domain/tools";
export type { ToolName } from "./domain/tools";
export { MAX_MCP_BODY_BYTES } from "./infrastructure/http";

export function postMcp(
  request: Request,
  database: PrismaClient = prisma,
  storage: DocumentStorage = getApplicationDocumentStorage(),
): Promise<Response> {
  return handleMcpPost(request, { database, storage });
}

export function rejectMcpMethod(): Response {
  return methodNotAllowed();
}
