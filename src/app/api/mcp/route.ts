// SPEC 2026-11-05-mcp-documentos, 5.2: the MCP endpoint lives in the mcp module.
import { postMcp, rejectMcpMethod } from "@/modules/mcp";

export function POST(request: Request): Promise<Response> {
  return postMcp(request);
}

export const GET = rejectMcpMethod;
export const DELETE = rejectMcpMethod;
