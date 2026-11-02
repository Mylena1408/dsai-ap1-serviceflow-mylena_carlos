import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import {
  createDomainCategory,
  createDomainRequest,
  createDomainSector,
  createDomainService,
  createDomainUser,
} from "./domain-fixtures";

// SPEC 2026-11-02-painel-relatorios, 5.4 (SF-100; CA-DASH-08 and CA-DASH-09).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { GET } from "@/app/api/reports/requests.csv/route";

function actAs(role: Role, sectorId: string | null = null) {
  session.getCurrentUser.mockResolvedValue({
    id: `${role.toLowerCase()}-actor`,
    name: role,
    email: `${role.toLowerCase()}@example.test`,
    role,
    sectorId,
    isActive: true,
  });
}

const call = (query = "") => GET(new Request(`http://localhost:3100/api/reports/requests.csv${query}`));

/** One request opened today in each of two sectors, with content that must never be exported. */
async function twoSectors() {
  const category = await createDomainCategory();
  const requester = await createDomainUser({ role: "REQUESTER" });
  const sectors = [];
  for (const description of ["Senha anotada no pedido A", "Senha anotada no pedido B"]) {
    const sector = await createDomainSector();
    const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
    const request = await createDomainRequest({ requesterId: requester.id, serviceId: service.id, sectorId: sector.id });
    await prisma.request.update({ where: { id: request.id }, data: { description } });
    sectors.push({ sector, service, request });
  }
  return { requester, sectors };
}

describe("CSV export route over the database (SF-100)", () => {
  it("exports the administrator's scope, or one sector, as a CSV download (CA-DASH-08)", async () => {
    const { sectors } = await twoSectors();
    actAs("ADMIN");

    const response = await call("?period=7");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="serviceflow-solicitacoes-\d{4}-\d{2}-\d{2}-a-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    const all = await response.text();
    expect(all.split("\r\n")).toHaveLength(1 + 2 + 1);
    for (const { request, service } of sectors) {
      expect(all).toContain(`${request.id.slice(0, 8).toUpperCase()};${service.name};`);
    }

    const one = await (await call(`?period=7&sector=${sectors[1].sector.id}`)).text();
    expect(one).toContain(sectors[1].service.name);
    expect(one).not.toContain(sectors[0].service.name);
  });

  it("exports only the manager's sector, whatever the URL says, without content or requester (CA-DASH-09)", async () => {
    const { sectors, requester } = await twoSectors();
    actAs("MANAGER", sectors[0].sector.id);

    const csv = await (await call(`?period=30&sector=${sectors[1].sector.id}`)).text();

    expect(csv).toContain(sectors[0].service.name);
    expect(csv).not.toContain(sectors[1].service.name);
    expect(csv).not.toContain("Senha anotada");
    expect(csv).not.toContain(requester.email);
    expect(csv).not.toContain(requester.name);
  });

  it("refuses attendants, requesters and anyone signed out", async () => {
    const { sectors } = await twoSectors();

    actAs("ATTENDANT", sectors[0].sector.id);
    expect((await call()).status).toBe(403);
    actAs("REQUESTER");
    expect((await call()).status).toBe(403);
    session.getCurrentUser.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it("refuses an invalid period or sector instead of exporting the default", async () => {
    await twoSectors();
    actAs("ADMIN");

    const period = await call("?period=custom&from=2026-10-31&to=2026-10-01");
    expect(period.status).toBe(400);
    expect(await period.text()).toBe("Período inválido. Volte ao painel e escolha outro período.");

    const sector = await call("?sector=00000000-0000-4000-8000-000000000000");
    expect(sector.status).toBe(400);
    expect(await sector.text()).toBe("Setor não encontrado. Volte ao painel e escolha outro setor.");
  });
});
