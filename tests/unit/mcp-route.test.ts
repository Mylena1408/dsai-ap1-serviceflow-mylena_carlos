import { describe, expect, it, vi } from "vitest";

// SPEC 2026-11-05-mcp-documentos, 5.2 (SF-139): the route file only points at the mcp module.

const mcp = vi.hoisted(() => ({
  postMcp: vi.fn(async () => new Response(null, { status: 202 })),
  rejectMcpMethod: vi.fn(() => new Response(null, { status: 405 })),
}));

vi.mock("@/modules/mcp", () => mcp);

import { DELETE, GET, POST } from "@/app/api/mcp/route";

describe("/api/mcp route", () => {
  it("hands POST to the module with only the request", async () => {
    const request = new Request("https://serviceflow.test/api/mcp", { method: "POST", body: "{}" });
    expect((await POST(request)).status).toBe(202);
    expect(mcp.postMcp).toHaveBeenCalledWith(request);
  });

  it("refuses GET and DELETE through the module", () => {
    expect(GET).toBe(mcp.rejectMcpMethod);
    expect(DELETE).toBe(mcp.rejectMcpMethod);
  });
});
