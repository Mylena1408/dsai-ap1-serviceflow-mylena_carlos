import {
  JSON_RPC_ERROR,
  completeResult,
  discoverResult,
  errorMessage,
  initializeResult,
  protocolFailure,
  successMessage,
  type Era,
  type JsonObject,
  type McpMessage,
} from "../domain/protocol";
import { TOOL_DEFINITIONS, isToolName } from "../domain/tools";
import type { McpCaller, McpToolOperations } from "./ports";
import { runTool } from "./run-tool";

// Method dispatch (SPEC 2026-11-05-mcp-documentos, 5.3 item 5): the message is already parsed,
// authenticated and placed in an era. The answer carries the HTTP status the transport sends.

export type McpAnswer = { status: 202 } | { status: number; body: JsonObject };

function methodNotFound(message: Extract<McpMessage, { kind: "request" }>): McpAnswer {
  const failure = protocolFailure(404, JSON_RPC_ERROR.METHOD_NOT_FOUND, "Method not found", message.id);
  return { status: failure.httpStatus, body: errorMessage(failure) };
}

export async function handleMessage(
  message: McpMessage,
  era: Era,
  caller: McpCaller,
  operations: McpToolOperations,
): Promise<McpAnswer> {
  // Notifications (for example `notifications/initialized`) need no answer (5.2 item 6).
  if (message.kind === "notification") return { status: 202 };

  const ok = (result: JsonObject): McpAnswer => ({ status: 200, body: successMessage(message.id, result) });

  switch (message.method) {
    case "initialize":
      if (era.kind !== "legacy") return methodNotFound(message);
      return ok(initializeResult(era.version));
    case "server/discover":
      return ok(discoverResult(era));
    case "ping":
      return ok(completeResult(era, {}));
    case "tools/list":
      return ok(completeResult(era, { tools: TOOL_DEFINITIONS }));
    case "tools/call": {
      const name = message.params.name;
      if (!isToolName(name)) {
        const failure = protocolFailure(200, JSON_RPC_ERROR.INVALID_PARAMS, "Unknown tool", message.id);
        return { status: failure.httpStatus, body: errorMessage(failure) };
      }
      const result = await runTool(name, message.params.arguments, caller, operations);
      return ok(completeResult(era, { ...result }));
    }
    default:
      return methodNotFound(message);
  }
}
