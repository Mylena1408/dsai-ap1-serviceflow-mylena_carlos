import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "@/server/errors";
import type { AuditTrailItem, AuditTrailReader } from "@/modules/audit/application/ports";

const authorization = vi.hoisted(() => ({ requireConfigurationAdministrator: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import { AUDIT_PAGE_SIZE, listAuditTrail } from "@/modules/audit/application/audit-trail";

// SPEC 2026-11-02-auditoria-lgpd, 5.2 (SF-104; CA-AUD-04).

const now = new Date("2026-11-02T15:00:00.000Z");
const sectorA = "11111111-1111-4111-8111-111111111111";
const sectorB = "22222222-2222-4222-8222-222222222222";

const change: AuditTrailItem = {
  kind: "change",
  id: "e1",
  occurredAt: new Date("2026-11-01T12:00:00.000Z"),
  actorId: "admin-1",
  actorName: "Ana",
  actorRole: "ADMIN",
  action: "UPDATED",
  entityType: "USER",
  entityId: "u1",
  entityLabel: "Carla",
  changes: [
    { field: "sectorId", before: sectorA, after: sectorB },
    { field: "name", personal: true },
    { field: "role", before: "REQUESTER", after: "ATTENDANT" },
  ],
};

function reader(total: number, overrides: Partial<AuditTrailReader> = {}): AuditTrailReader {
  return {
    count: vi.fn(async () => total),
    list: vi.fn(async () => [change]),
    actors: vi.fn(async () => [{ id: "admin-1", name: "Ana" }]),
    names: vi.fn(async (ids: readonly string[]) => Object.fromEntries(ids.map((id) => [id, `Setor ${id.slice(0, 1)}`]))),
    ...overrides,
  };
}

describe("audit trail (SF-104; CA-AUD-04)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorization.requireConfigurationAdministrator.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
  });

  it("reads the last 30 days, every type and person, first page of 50", async () => {
    const port = reader(1);

    const trail = await listAuditTrail({}, port, now);

    expect(port.count).toHaveBeenCalledWith({
      from: new Date("2026-10-04T03:00:00.000Z"),
      before: new Date("2026-11-03T03:00:00.000Z"),
      entity: null,
      actorId: null,
    });
    expect(port.list).toHaveBeenCalledWith(expect.anything(), 0, AUDIT_PAGE_SIZE);
    expect(AUDIT_PAGE_SIZE).toBe(50);
    expect(trail).toMatchObject({
      errors: { period: null, entity: null, actor: null },
      filters: { entity: null, actorId: null },
      total: 1,
      page: 1,
      pageCount: 1,
      items: [change],
    });
  });

  it("names only the sectors and categories mentioned by the changes", async () => {
    const port = reader(1);

    const trail = await listAuditTrail({}, port, now);

    expect(port.names).toHaveBeenCalledWith([sectorA, sectorB]);
    expect(trail.names).toEqual({ [sectorA]: "Setor 1", [sectorB]: "Setor 2" });
  });

  it("filters by type, including permissions, and by a person of the trail", async () => {
    const port = reader(3);

    const trail = await listAuditTrail({ period: "7", entity: "PERMISSION", actor: "admin-1" }, port, now);

    expect(port.count).toHaveBeenCalledWith(expect.objectContaining({ entity: "PERMISSION", actorId: "admin-1" }));
    expect(trail.filters).toEqual({ entity: "PERMISSION", actorId: "admin-1" });
    expect(trail.period.option).toBe("7");
  });

  it("reports and ignores an unknown type, an unknown person and a refused period", async () => {
    const port = reader(1);

    const trail = await listAuditTrail(
      { entity: "PASSWORD", actor: "someone-else", period: "custom", from: "2026-10-31", to: "2026-10-01" },
      port,
      now,
    );

    expect(trail.errors).toEqual({ period: "inverted_range", entity: "invalid_entity", actor: "invalid_actor" });
    expect(trail.filters).toEqual({ entity: null, actorId: null });
    expect(trail.period.option).toBe("30");
  });

  it("pages by 50 and shows the last page for a page beyond it", async () => {
    const port = reader(120);

    expect(await listAuditTrail({ page: "2" }, port, now)).toMatchObject({ page: 2, pageCount: 3 });
    expect(port.list).toHaveBeenLastCalledWith(expect.anything(), 50, 50);
    expect(await listAuditTrail({ page: "9" }, port, now)).toMatchObject({ page: 3 });
    expect(port.list).toHaveBeenLastCalledWith(expect.anything(), 100, 50);
    expect(await listAuditTrail({ page: "x" }, port, now)).toMatchObject({ page: 1 });
  });

  it("does not list anything when nothing matches", async () => {
    const port = reader(0);

    const trail = await listAuditTrail({}, port, now);

    expect(port.list).not.toHaveBeenCalled();
    expect(port.names).not.toHaveBeenCalled();
    expect(trail).toMatchObject({ items: [], total: 0, page: 1, pageCount: 1, names: {} });
  });

  it("refuses anyone but the administrator before reading anything", async () => {
    authorization.requireConfigurationAdministrator.mockRejectedValue(new AuthorizationError());
    const port = reader(1);

    await expect(listAuditTrail({}, port, now)).rejects.toBeInstanceOf(AuthorizationError);
    for (const method of Object.values(port)) {
      expect(method).not.toHaveBeenCalled();
    }
  });
});
