import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SectorLoad } from "@/modules/requests/application/team-load";

const authorization = vi.hoisted(() => ({ actor: null as unknown, supervisor: false }));
vi.mock("@/server/authorization", () => ({
  requireCurrentActor: vi.fn(async () => authorization.actor),
  actorHasPermission: vi.fn(async () => authorization.supervisor),
}));

import { atLimit, getTeamLoad } from "@/modules/requests/application/team-load";
import { TeamLoad, memberSituation, sectorLoadSummary } from "@/app/_components/team-load";

// SPEC 2026-11-07-operacao-e-automacao, 4.3 item 8 (SF-183; CA-DST-06 by the rules and the screens).

const load = (overrides: Partial<SectorLoad> = {}): SectorLoad => ({
  sectorId: "ti",
  sectorName: "TI",
  mode: "ROUND_ROBIN",
  maxActivePerAttendant: 2,
  unassigned: 3,
  members: [
    { id: "a", name: "Ana", activeRequests: 2, absentToday: false },
    { id: "b", name: "Bia", activeRequests: 0, absentToday: true },
    { id: "c", name: "Caio", activeRequests: 1, absentToday: false },
  ],
  ...overrides,
});

describe("who sees the team's load (4.3 item 8)", () => {
  const reader = () => ({ loads: vi.fn(async () => [load()]) });

  beforeEach(() => {
    authorization.supervisor = false;
  });

  it("the administrator every sector; the manager and the supervisor their own; others nothing", async () => {
    authorization.actor = { id: "adm", role: "ADMIN", isActive: true, sectorId: null };
    const asAdmin = reader();
    await getTeamLoad(asAdmin);
    expect(asAdmin.loads).toHaveBeenCalledWith(null);

    authorization.actor = { id: "g", role: "MANAGER", isActive: true, sectorId: "ti" };
    const asManager = reader();
    await getTeamLoad(asManager);
    expect(asManager.loads).toHaveBeenCalledWith("ti");

    authorization.actor = { id: "a", role: "ATTENDANT", isActive: true, sectorId: "ti" };
    await expect(getTeamLoad(reader())).resolves.toBeNull();
    authorization.supervisor = true;
    const asSupervisor = reader();
    await getTeamLoad(asSupervisor);
    expect(asSupervisor.loads).toHaveBeenCalledWith("ti");

    authorization.actor = { id: "r", role: "REQUESTER", isActive: true, sectorId: null };
    await expect(getTeamLoad(reader())).resolves.toBeNull();
  });

  it("says who is at the limit, absent or available", () => {
    const current = load();
    expect(atLimit(current.members[0], current)).toBe(true);
    expect(atLimit(current.members[2], current)).toBe(false);
    expect(atLimit(current.members[0], load({ maxActivePerAttendant: null }))).toBe(false);
    expect(current.members.map((member) => memberSituation(member, current))).toEqual(["No limite", "Ausente hoje", "Disponível"]);
    expect(sectorLoadSummary(current)).toBe("Distribuição: Rodízio · até 2 por atendente · 3 na fila sem responsável");
    expect(sectorLoadSummary(load({ mode: "NONE", unassigned: 1 }))).toBe("Distribuição: Desligada · 1 na fila sem responsável");
    expect(sectorLoadSummary(load({ mode: "LEAST_LOAD", maxActivePerAttendant: null }))).toBe("Distribuição: Menor carga · sem limite · 3 na fila sem responsável");
  });

  it("shows one table per sector, and nothing without loads", () => {
    const html = renderToStaticMarkup(createElement(TeamLoad, { loads: [load(), load({ sectorId: "rh", sectorName: "RH", members: [] })] }));
    expect(html).toContain("Carga da equipe");
    expect(html).toContain("<caption>Carga de TI</caption>");
    expect(html).toContain("<h3>RH</h3>");
    expect(html).toContain("Nenhum atendente ativo.");
    expect(renderToStaticMarkup(createElement(TeamLoad, { loads: null }))).toBe("");
    expect(renderToStaticMarkup(createElement(TeamLoad, { loads: [] }))).toBe("");
    // One sector: no sector heading.
    expect(renderToStaticMarkup(createElement(TeamLoad, { loads: [load()] }))).not.toContain("<h3>");
  });
});
