import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./fixtures";
import { AuthorizationError } from "@/server/errors";
import { createDomainSector, createDomainUser } from "./domain-fixtures";
import { createPrismaAuditTrailReader } from "@/modules/audit/infrastructure/prisma-audit-trail-reader";

// SPEC 2026-11-02-auditoria-lgpd, 5.2 (SF-104; CA-AUD-04).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { listAuditTrail } from "@/modules/audit";
import { grantPermission } from "@/modules/permissions";
import { createSector, updateSector } from "@/modules/sectors";
import { createUser, updateUser } from "@/modules/users";

const now = new Date("2026-11-02T15:00:00.000Z");
const lastMonth = { from: new Date("2026-10-04T03:00:00.000Z"), before: new Date("2026-11-03T03:00:00.000Z") };

function actAs(user: Pick<User, "id" | "name" | "email" | "role" | "sectorId" | "isActive">) {
  session.getCurrentUser.mockResolvedValue({ ...user });
}

/** Changes by two administrators through the real use cases, then dated inside the period. */
async function scenario() {
  const ana = await prisma.user.create({
    data: { name: "Ana Lima", email: "ana@exemplo.test", role: "ADMIN", passwordHash: "$argon2id$integration-placeholder" },
  });
  const bruno = await prisma.user.create({
    data: { name: "Bruno Dias", email: "bruno@exemplo.test", role: "ADMIN", passwordHash: "$argon2id$integration-placeholder" },
  });

  actAs(ana);
  const sector = await createSector({ name: "Infraestrutura" }, prisma);
  const other = await createDomainSector();
  const attendant = await createUser(
    { name: "Diego Rocha", email: "diego@exemplo.test", password: "Senha-de-teste-1", role: "ATTENDANT", sectorId: sector.id },
    prisma,
  );
  actAs(bruno);
  await updateSector(sector.id, { name: "Infraestrutura predial" }, prisma);
  await updateUser(attendant.id, { name: "Diego Rocha", email: "diego@exemplo.test", role: "ATTENDANT", sectorId: other.id }, prisma);
  await grantPermission({ userId: attendant.id, permission: "QUEUE_SUPERVISION" }, prisma);

  // Spread the records over the last days, in the order they were made.
  const entries = await prisma.auditEntry.findMany({ orderBy: { occurredAt: "asc" } });
  for (const [index, entry] of entries.entries()) {
    await prisma.auditEntry.update({ where: { id: entry.id }, data: { occurredAt: new Date(Date.UTC(2026, 9, 28 + index, 12)) } });
  }
  await prisma.userPermissionEvent.updateMany({ data: { occurredAt: new Date(Date.UTC(2026, 10, 2, 12)) } });

  return { ana, bruno, sector, other, attendant };
}

describe("audit trail over the database (SF-104)", () => {
  it("lists audit entries and permission events together, most recent first, with current names", async () => {
    const { ana, bruno, sector, other, attendant } = await scenario();
    actAs(ana);

    const trail = await listAuditTrail({}, prisma, now);

    expect(trail.total).toBe(5);
    expect(
      trail.items.map((item) => (item.kind === "permission" ? `permission ${item.action}` : `${item.action} ${item.entityType}`)),
    ).toEqual(["permission GRANTED", "UPDATED USER", "UPDATED SECTOR", "CREATED USER", "CREATED SECTOR"]);
    expect(trail.items[0]).toMatchObject({
      kind: "permission",
      permission: "QUEUE_SUPERVISION",
      userName: "Diego Rocha",
      actorId: bruno.id,
      actorName: "Bruno Dias",
      actorRole: "ADMIN",
    });
    expect(trail.items[1]).toMatchObject({
      kind: "change",
      entityId: attendant.id,
      actorName: "Bruno Dias",
      changes: [{ field: "sectorId", before: sector.id, after: other.id }],
    });
    expect(trail.items[4]).toMatchObject({ entityLabel: "Infraestrutura", actorId: ana.id, actorName: "Ana Lima" });
    expect(trail.names).toEqual({ [sector.id]: "Infraestrutura predial", [other.id]: other.name });
    expect(trail.actors).toEqual([
      { id: ana.id, name: "Ana Lima" },
      { id: bruno.id, name: "Bruno Dias" },
    ]);
  });

  it("filters by period, type and person, and pages in the database", async () => {
    const { ana, bruno } = await scenario();
    actAs(ana);
    const reader = createPrismaAuditTrailReader(prisma);

    await expect(listAuditTrail({ entity: "SECTOR" }, prisma, now)).resolves.toMatchObject({ total: 2 });
    await expect(listAuditTrail({ entity: "PERMISSION" }, prisma, now)).resolves.toMatchObject({ total: 1 });
    await expect(listAuditTrail({ actor: ana.id }, prisma, now)).resolves.toMatchObject({ total: 2 });
    await expect(listAuditTrail({ actor: bruno.id, entity: "USER" }, prisma, now)).resolves.toMatchObject({ total: 1 });
    await expect(listAuditTrail({ period: "custom", from: "2026-10-28", to: "2026-10-29" }, prisma, now)).resolves.toMatchObject({
      total: 2,
    });

    const filter = { ...lastMonth, entity: null, actorId: null };
    await expect(reader.count(filter)).resolves.toBe(5);
    const firstTwo = await reader.list(filter, 0, 2);
    const nextTwo = await reader.list(filter, 2, 2);
    expect([...firstTwo, ...nextTwo].map((item) => item.id)).toEqual((await reader.list(filter, 0, 4)).map((item) => item.id));
  });

  it("shows only the administrator, and names an actor that is not a user", async () => {
    const { ana } = await scenario();
    await prisma.auditEntry.create({
      data: {
        actorId: "admin-from-server-session",
        actorRole: "ADMIN",
        action: "CREATED",
        entityType: "CATEGORY",
        entityId: "33333333-3333-4333-8333-333333333333",
        entityLabel: "TI",
        occurredAt: new Date(Date.UTC(2026, 10, 1, 9)),
      },
    });
    actAs(ana);

    const trail = await listAuditTrail({ entity: "CATEGORY" }, prisma, now);
    expect(trail.items).toMatchObject([{ actorName: null, actorRole: "ADMIN", entityLabel: "TI" }]);
    expect(trail.actors).toContainEqual({ id: "admin-from-server-session", name: "Pessoa não encontrada" });

    for (const role of ["REQUESTER", "ATTENDANT", "MANAGER"] as const) {
      const sector = role === "REQUESTER" ? null : await createDomainSector();
      actAs(await createDomainUser({ role, sectorId: sector?.id ?? null }));
      await expect(listAuditTrail({}, prisma, now)).rejects.toBeInstanceOf(AuthorizationError);
    }
  });
});
