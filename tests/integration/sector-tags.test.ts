import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { createDomainSector, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-08-atendimento-dia-a-dia, 3.3 item 1 (SF-195; CA-ETQ-02).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { MAX_ACTIVE_TAGS_PER_SECTOR, createSectorTag, listSectorTags, setSectorTagActive, updateSectorTag } from "@/modules/tags";

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });

async function scenario() {
  const ti = await createDomainSector();
  const rh = await createDomainSector();
  const admin = await createDomainUser({ role: "ADMIN" });
  const gabi = await createDomainUser({ role: "MANAGER", sectorId: ti.id });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: ti.id });
  return { ti, rh, admin, gabi, ana };
}

describe("the sectors' tags (3.3 item 1; CA-ETQ-02)", () => {
  it("the administrator for every sector, a manager for their own, nobody else", async () => {
    const { ti, rh, admin, gabi, ana } = await scenario();

    actAs(gabi);
    await createSectorTag(ti.id, { name: "Rede", color: "blue" });
    await expect(createSectorTag(rh.id, { name: "Folha", color: "green" })).rejects.toBeInstanceOf(AuthorizationError);
    expect((await listSectorTags()).map(({ sector }) => sector.id)).toEqual([ti.id]);

    actAs(ana);
    await expect(createSectorTag(ti.id, { name: "Outra", color: "red" })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(listSectorTags()).rejects.toBeInstanceOf(AuthorizationError);

    actAs(admin);
    await createSectorTag(rh.id, { name: "Folha", color: "green" });
    const listed = await listSectorTags();
    expect(listed.find(({ sector }) => sector.id === ti.id)?.tags).toEqual([expect.objectContaining({ name: "Rede", color: "blue", isActive: true, inUse: 0 })]);
    expect(listed.find(({ sector }) => sector.id === rh.id)?.tags.map(({ name }) => name)).toEqual(["Folha"]);
  });

  it("changes, deactivates and reactivates with the audit trail; names are unique among the active ones", async () => {
    const { ti, rh, gabi } = await scenario();
    actAs(gabi);
    const tag = await createSectorTag(ti.id, { name: "Rede", color: "blue" });
    await expect(createSectorTag(ti.id, { name: "REDE", color: "red" })).rejects.toBeInstanceOf(ConflictError);

    await updateSectorTag(tag.id, { name: "Rede e Wi-Fi", color: "teal" });
    await setSectorTagActive(tag.id, false);
    // The name is free while the tag is inactive, and reactivating it then is a conflict.
    await createSectorTag(ti.id, { name: "Rede e Wi-Fi", color: "gray" });
    await expect(setSectorTagActive(tag.id, true)).rejects.toBeInstanceOf(ConflictError);

    const entries = await prisma.auditEntry.findMany({ where: { entityType: "SECTOR_TAG", entityId: tag.id }, orderBy: { occurredAt: "asc" } });
    expect(entries.map(({ action }) => action)).toEqual(["CREATED", "UPDATED", "DEACTIVATED"]);
    expect(entries[1].changes).toEqual(
      expect.arrayContaining([
        { field: "name", before: "Rede", after: "Rede e Wi-Fi" },
        { field: "color", before: "blue", after: "teal" },
      ]),
    );

    // A tag of another sector is not reachable.
    const { admin } = await scenario();
    actAs(admin);
    const other = await createSectorTag(rh.id, { name: "Folha", color: "green" });
    actAs(gabi);
    await expect(updateSectorTag(other.id, { name: "X", color: "red" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(setSectorTagActive(other.id, false)).rejects.toBeInstanceOf(NotFoundError);
  });

  it(`refuses invalid values and more than ${MAX_ACTIVE_TAGS_PER_SECTOR} active tags per sector`, async () => {
    const { ti, admin } = await scenario();
    actAs(admin);
    for (const input of [{ name: "", color: "blue" }, { name: "Rosa", color: "pink" }, { name: "x".repeat(31), color: "blue" }]) {
      await expect(createSectorTag(ti.id, input)).rejects.toBeInstanceOf(ValidationError);
    }
    await prisma.sectorTag.createMany({ data: Array.from({ length: MAX_ACTIVE_TAGS_PER_SECTOR - 1 }, (_, index) => ({ sectorId: ti.id, name: `Etiqueta ${index}`, color: "gray" })) });
    const last = await createSectorTag(ti.id, { name: "A trigésima", color: "blue" });
    await expect(createSectorTag(ti.id, { name: "Mais uma", color: "blue" })).rejects.toMatchObject({ issues: [{ path: [], code: "too_big" }] });
    await setSectorTagActive(last.id, false);
    await expect(createSectorTag(ti.id, { name: "Mais uma", color: "blue" })).resolves.toMatchObject({ isActive: true });
    await expect(setSectorTagActive(last.id, true)).rejects.toMatchObject({ issues: [{ path: [], code: "too_big" }] });
  });
});
