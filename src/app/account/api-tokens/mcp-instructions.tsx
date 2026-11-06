// How to connect an MCP assistant with a token of this page (SPEC 2026-11-05-mcp-documentos, 5.5
// and decision M9). The address comes from the request that rendered the page, so it matches the
// domain the person is using; without a host it falls back to a placeholder.

export const MCP_PATH = "/api/mcp";

export function mcpEndpointUrl(requestHeaders: Pick<Headers, "get">): string {
  const host = (requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"))?.split(",")[0]?.trim();
  if (!host || !/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)) return `https://<endereço>${MCP_PATH}`;
  const forwarded = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const protocol = forwarded === "http" || forwarded === "https" ? forwarded : local ? "http" : "https";
  return `${protocol}://${host}${MCP_PATH}`;
}

export function McpInstructions({ url }: { url: string }) {
  const command = `claude mcp add --transport http serviceflow ${url} \\\n  --header "Authorization: Bearer sf_..."`;

  return (
    <section aria-labelledby="api-tokens-mcp-title" className="surface-card">
      <h2 id="api-tokens-mcp-title">Assistentes de IA (MCP)</h2>
      <p>
        Um assistente compatível com MCP, como o Claude Code ou o Claude Desktop, pode procurar suas solicitações e ler os
        documentos e arquivos de comentário que você já vê aqui. Ele só lê: não abre, não comenta e não altera nada, então um
        token &quot;Somente leitura&quot; basta.
      </p>
      <p>
        Endereço do servidor MCP: <code>{url}</code>
      </p>
      <p>No Claude Code, troque <code>sf_...</code> pelo seu token:</p>
      <pre className="mcp-command">
        <code>{command}</code>
      </pre>
      <p className="metadata">
        O assistente lê tudo o que você lê, inclusive documentos pessoais anexados às solicitações. As chamadas contam no
        mesmo limite do token. Revogue o token quando deixar de usar o assistente.
      </p>
    </section>
  );
}
