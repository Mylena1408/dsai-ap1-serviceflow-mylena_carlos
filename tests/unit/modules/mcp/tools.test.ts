import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  MANAGER_FILTERS,
  REQUEST_STATUSES,
  TOOL_DEFINITIONS,
  TOOL_NAMES,
  checkToolArguments,
  isToolName,
  toolArgumentSchemas,
} from "@/modules/mcp/domain/tools";

// SPEC 2026-11-05-mcp-documentos, 5.4 (SF-139): announced tools and argument checks.

const uuid = "11111111-1111-4111-8111-111111111111";

describe("tool definitions", () => {
  it("announces the four tools in a fixed order", () => {
    expect(TOOL_DEFINITIONS.map(({ name }) => name)).toEqual([...TOOL_NAMES]);
    expect(TOOL_NAMES).toEqual(["find_requests", "list_request_documents", "read_request_document", "read_comment_file"]);
  });

  it("marks every tool as read-only and closed-world", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    }
  });

  it("uses tool names within the recommended character set", () => {
    for (const name of TOOL_NAMES) expect(name).toMatch(/^[A-Za-z0-9_.-]{1,128}$/);
  });

  it.each(TOOL_DEFINITIONS.map((tool) => [tool.name, tool]))(
    "keeps the JSON Schema of %s equal to its argument schema",
    (name, tool) => {
      const zodSchema = z.toJSONSchema(toolArgumentSchemas[name as keyof typeof toolArgumentSchemas]) as {
        properties: Record<string, unknown>;
        required?: string[];
      };
      const announced = tool.inputSchema as { properties: Record<string, unknown>; required?: string[]; additionalProperties: unknown };
      expect(Object.keys(announced.properties).sort()).toEqual(Object.keys(zodSchema.properties).sort());
      expect([...(announced.required ?? [])].sort()).toEqual([...(zodSchema.required ?? [])].sort());
      expect(announced.additionalProperties).toBe(false);
      expect(announced).toMatchObject({ type: "object" });
    },
  );

  it("describes every tool and every property for the model", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.title.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(40);
      for (const property of Object.values(tool.inputSchema.properties as Record<string, { description?: string }>)) {
        expect(property.description?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it("offers the request statuses and manager filters of the API", () => {
    expect(REQUEST_STATUSES).toEqual(["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);
    expect(MANAGER_FILTERS).toEqual(["pending", "all", "sector"]);
  });
});

describe("isToolName", () => {
  it.each(TOOL_NAMES.map((name) => [name]))("accepts %s", (name) => {
    expect(isToolName(name)).toBe(true);
  });

  it.each([["delete_request"], ["FIND_REQUESTS"], [""], [undefined], [3], [null]])("refuses %j", (value) => {
    expect(isToolName(value)).toBe(false);
  });
});

describe("checkToolArguments", () => {
  it("accepts find_requests without arguments, with null or an empty object", () => {
    expect(checkToolArguments("find_requests", undefined)).toEqual({ ok: true, value: {} });
    expect(checkToolArguments("find_requests", null)).toEqual({ ok: true, value: {} });
    expect(checkToolArguments("find_requests", {})).toEqual({ ok: true, value: {} });
  });

  it("accepts every find_requests filter", () => {
    const input = { q: "férias", status: ["OPEN", "IN_PROGRESS"], page: 2, filter: "all" };
    expect(checkToolArguments("find_requests", input)).toEqual({ ok: true, value: input });
  });

  it("accepts the identifiers of the reading tools without checking their format", () => {
    expect(checkToolArguments("list_request_documents", { requestId: "not-a-uuid" })).toEqual({
      ok: true,
      value: { requestId: "not-a-uuid" },
    });
    expect(checkToolArguments("read_request_document", { requestId: uuid, attachmentId: uuid }).ok).toBe(true);
    expect(checkToolArguments("read_comment_file", { requestId: uuid, commentId: uuid, fileId: uuid }).ok).toBe(true);
  });

  it.each([
    ["find_requests", { page: 0 }, "page: too small"],
    ["find_requests", { page: 1.5 }, "page: wrong type"],
    ["find_requests", { page: "2" }, "page: wrong type"],
    ["find_requests", { page: 10_001 }, "page: too large"],
    ["find_requests", { status: [] }, "status: too small"],
    ["find_requests", { status: ["DONE"] }, "status.0: not an accepted value"],
    ["find_requests", { filter: "everything" }, "filter: not an accepted value"],
    ["find_requests", { q: "x".repeat(201) }, "q: too large"],
    ["find_requests", { owner: "me" }, "unknown field(s): owner"],
    ["list_request_documents", {}, "requestId: required"],
    ["list_request_documents", { requestId: "" }, "requestId: too small"],
    ["list_request_documents", { requestId: 12 }, "requestId: wrong type"],
    ["list_request_documents", { requestId: "x".repeat(101) }, "requestId: too large"],
    ["read_request_document", { requestId: uuid }, "attachmentId: required"],
    ["read_comment_file", { requestId: uuid, commentId: uuid }, "fileId: required"],
    ["read_comment_file", { requestId: uuid, commentId: uuid, fileId: uuid, path: "/etc" }, "unknown field(s): path"],
  ] as const)("refuses %s %j naming the field", (name, input, expected) => {
    const outcome = checkToolArguments(name, input);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain(expected);
    expect(outcome.message.startsWith("Invalid arguments.")).toBe(true);
  });

  it("refuses arguments that are not an object", () => {
    const outcome = checkToolArguments("list_request_documents", "id");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain("arguments: wrong type");
  });

  it("never echoes the refused values", () => {
    const secret = "sf_secret_value_that_must_not_leak";
    const outcome = checkToolArguments("find_requests", { q: secret.repeat(20), extra: secret });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).not.toContain(secret);
  });
});
