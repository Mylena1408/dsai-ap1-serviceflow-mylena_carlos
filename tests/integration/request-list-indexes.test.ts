import { describe, expect, it } from "vitest";
import { prisma } from "./fixtures";

// SPEC 2026-10-31-busca-filtros-paginacao, section 6 (SF-057).

describe("request list indexes (SF-057)", () => {
  it("creates the per-reader order indexes", async () => {
    const rows = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'Request'
    `;
    const definitions = Object.fromEntries(rows.map(({ indexname, indexdef }) => [indexname, indexdef]));

    expect(definitions["Request_requesterId_createdAt_id_idx"]).toContain('("requesterId", "createdAt", id)');
    expect(definitions["Request_sectorId_createdAt_id_idx"]).toContain('("sectorId", "createdAt", id)');
  });
});
