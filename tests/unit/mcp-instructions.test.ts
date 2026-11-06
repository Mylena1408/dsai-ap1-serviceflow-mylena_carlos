import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { McpInstructions, mcpEndpointUrl } from "@/app/account/api-tokens/mcp-instructions";

// SPEC 2026-11-05-mcp-documentos, 5.5 (SF-141): connection instructions on "Acesso à API".

describe("mcpEndpointUrl", () => {
  it("uses the forwarded host and protocol of the deployment", () => {
    const headers = new Headers({ host: "internal:3000", "x-forwarded-host": "serviceflow-sand.vercel.app", "x-forwarded-proto": "https" });
    expect(mcpEndpointUrl(headers)).toBe("https://serviceflow-sand.vercel.app/api/mcp");
  });

  it("takes the first value of a forwarded list", () => {
    const headers = new Headers({ "x-forwarded-host": "a.example, b.example", "x-forwarded-proto": "https, http" });
    expect(mcpEndpointUrl(headers)).toBe("https://a.example/api/mcp");
  });

  it("assumes http on localhost and https elsewhere when no protocol is forwarded", () => {
    expect(mcpEndpointUrl(new Headers({ host: "localhost:3000" }))).toBe("http://localhost:3000/api/mcp");
    expect(mcpEndpointUrl(new Headers({ host: "serviceflow.example" }))).toBe("https://serviceflow.example/api/mcp");
  });

  it("ignores an unknown forwarded protocol", () => {
    expect(mcpEndpointUrl(new Headers({ host: "serviceflow.example", "x-forwarded-proto": "javascript" }))).toBe(
      "https://serviceflow.example/api/mcp",
    );
  });

  it.each([[{}], [{ host: "evil.example/path" }], [{ host: "a b" }], [{ host: "<script>" }]])(
    "falls back to a placeholder for the headers %j",
    (values) => {
      expect(mcpEndpointUrl(new Headers(values as Record<string, string>))).toBe("https://<endereço>/api/mcp");
    },
  );
});

describe("McpInstructions", () => {
  const html = renderToStaticMarkup(createElement(McpInstructions, { url: "https://serviceflow.example/api/mcp" }));

  it("shows the address and the Claude Code command with a token placeholder", () => {
    expect(html).toContain("Assistentes de IA (MCP)");
    expect(html).toContain("<code>https://serviceflow.example/api/mcp</code>");
    expect(html).toContain("claude mcp add --transport http serviceflow https://serviceflow.example/api/mcp");
    expect(html).toContain("Authorization: Bearer sf_...");
  });

  it("warns that the assistant reads what the person reads and suggests a read-only token", () => {
    expect(html).toContain("O assistente lê tudo o que você lê");
    expect(html).toContain("Somente leitura");
    expect(html).toContain("Revogue o token");
  });
});
