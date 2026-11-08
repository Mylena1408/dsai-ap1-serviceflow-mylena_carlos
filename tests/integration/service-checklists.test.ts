import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-08-atendimento-dia-a-dia, 4.1 item 1 and 4.3 item 1 (SF-201; CA-CHK-02).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import {
  MAX_ACTIVE_CHECKLIST_ITEMS,
  createChecklistItem,
  listServiceChecklists,
  moveChecklistItem,
  setChecklistItemActive,
  updateChecklistItem,
} from "@/modules/checklists";

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });

async function scenario() {
  const ti = await createDomainSector();
  const rh = await createDomainSector();
  const category = await createDomainCategory();
  const install = await createDomainService({ categoryId: category.id, sectorId: ti.id });
  const vacation = await createDomainService({ categoryId: category.id, sectorId: rh.id });
  const admin = await createDomainUser({ role: "ADMIN" });
  const gabi = await createDomainUser({ role: "MANAGER", sectorId: ti.id });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: ti.id });
  return { ti, rh, install, vacation, admin, gabi, ana };
}

const texts = async (serviceId: string) =>
  (await prisma.serviceChecklistItem.findMany({ where: { serviceId, isActive: true }, orderBy: { position: "asc" }, select: { text: true } })).map(
    ({ text }) => text,
  );

describe("the services' checklist models (4.3 item 1; CA-CHK-02)", () => {
  it("the administrator for every service, a manager for their sector's, nobody else", async () => {
    const { install, vacation, admin, gabi, ana } = await scenario();

    actAs(gabi);
    await createChecklistItem(install.id, { text: "Conferir licença", isRequired: true });
    await expect(createChecklistItem(vacation.id, { text: "Saldo", isRequired: true })).rejects.toBeInstanceOf(AuthorizationError);
    expect((await listServiceChecklists()).map(({ service }) => service.id)).toEqual([install.id]);

    actAs(ana);
    await expect(createChecklistItem(install.id, { text: "Outro", isRequired: false })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(listServiceChecklists()).rejects.toBeInstanceOf(AuthorizationError);

    actAs(admin);
    const saldo = await createChecklistItem(vacation.id, { text: "  Conferir saldo  ", isRequired: false });
    expect(saldo).toMatchObject({ text: "Conferir saldo", isRequired: false, position: 1, isActive: true });
    expect((await listServiceChecklists()).map(({ service }) => service.id).sort()).toEqual([install.id, vacation.id].sort());

    // The manager does not see nor change another sector's item.
    actAs(gabi);
    await expect(updateChecklistItem(saldo.id, { text: "Mudado", isRequired: true })).rejects.toBeInstanceOf(NotFoundError);
    await expect(setChecklistItemActive(saldo.id, false)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("changes, moves, deactivates and reactivates, each in the audit trail", async () => {
    const { install, gabi } = await scenario();
    actAs(gabi);
    const first = await createChecklistItem(install.id, { text: "Instalar", isRequired: true });
    const second = await createChecklistItem(install.id, { text: "Testar", isRequired: true });
    const third = await createChecklistItem(install.id, { text: "Avisar", isRequired: false });

    await updateChecklistItem(second.id, { text: "Testar o acesso", isRequired: false });
    await moveChecklistItem(third.id, "up");
    expect(await texts(install.id)).toEqual(["Instalar", "Avisar", "Testar o acesso"]);
    // The first moved up changes nothing and records nothing.
    await moveChecklistItem(first.id, "up");

    await setChecklistItemActive(first.id, false);
    expect(await texts(install.id)).toEqual(["Avisar", "Testar o acesso"]);
    await expect(moveChecklistItem(first.id, "down")).rejects.toBeInstanceOf(ConflictError);
    // Reactivated, it goes to the end.
    await setChecklistItemActive(first.id, true);
    expect(await texts(install.id)).toEqual(["Avisar", "Testar o acesso", "Instalar"]);

    const entries = await prisma.auditEntry.findMany({
      where: { entityType: "CHECKLIST_ITEM" },
      orderBy: { occurredAt: "asc" },
      select: { action: true, entityId: true, entityLabel: true, changes: true },
    });
    expect(entries.map(({ action }) => action)).toEqual(["CREATED", "CREATED", "CREATED", "UPDATED", "REORDERED", "DEACTIVATED", "REACTIVATED"]);
    expect(entries[3]).toMatchObject({ entityId: second.id, entityLabel: "Testar o acesso" });
    expect(entries[3].changes).toEqual([
      { field: "text", before: "Testar", after: "Testar o acesso" },
      { field: "isRequired", before: true, after: false },
    ]);
    expect(entries[4]).toMatchObject({ entityId: third.id, changes: [{ field: "position", before: 3, after: 2 }] });
  });

  it("keeps at most 20 active items and refuses an empty or long text", async () => {
    const { install, admin } = await scenario();
    actAs(admin);
    await prisma.serviceChecklistItem.createMany({
      data: Array.from({ length: MAX_ACTIVE_CHECKLIST_ITEMS }, (_, index) => ({ serviceId: install.id, text: `Item ${index + 1}`, isRequired: false, position: index + 1 })),
    });
    await expect(createChecklistItem(install.id, { text: "Mais um", isRequired: true })).rejects.toBeInstanceOf(ValidationError);

    const last = await prisma.serviceChecklistItem.findFirstOrThrow({ where: { serviceId: install.id, position: 20 } });
    await setChecklistItemActive(last.id, false);
    const extra = await createChecklistItem(install.id, { text: "Mais um", isRequired: true });
    expect(extra.position).toBe(21);
    // Reactivating would make 21 active.
    await expect(setChecklistItemActive(last.id, true)).rejects.toBeInstanceOf(ValidationError);

    await expect(createChecklistItem(install.id, { text: "  ", isRequired: true })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateChecklistItem(extra.id, { text: "x".repeat(121), isRequired: true })).rejects.toBeInstanceOf(ValidationError);
  });

  it("an inactive service gets no items; the copies already made do not change (decision I7)", async () => {
    const { ti, install, vacation, admin } = await scenario();
    actAs(admin);
    const item = await createChecklistItem(install.id, { text: "Instalar", isRequired: true });
    const rita = await createDomainUser({ role: "REQUESTER" });
    const request = await createDomainRequest({ requesterId: rita.id, serviceId: install.id, sectorId: ti.id });
    await prisma.requestChecklistItem.create({ data: { requestId: request.id, templateItemId: item.id, textSnapshot: "Instalar", isRequired: true, position: 1 } });

    await updateChecklistItem(item.id, { text: "Instalar e testar", isRequired: false });
    await setChecklistItemActive(item.id, false);
    expect(await prisma.requestChecklistItem.findFirstOrThrow({ where: { requestId: request.id }, select: { textSnapshot: true, isRequired: true } })).toEqual({
      textSnapshot: "Instalar",
      isRequired: true,
    });

    await prisma.service.update({ where: { id: install.id }, data: { isActive: false } });
    await expect(createChecklistItem(install.id, { text: "Outro", isRequired: true })).rejects.toBeInstanceOf(NotFoundError);
    expect((await listServiceChecklists()).map(({ service }) => service.id)).toEqual([vacation.id]);
  });
});
