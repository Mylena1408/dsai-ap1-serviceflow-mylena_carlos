import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { AuthorizationError, ValidationError } from "@/server/errors";
import { createDomainCategory, createDomainSector, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { MAX_ACTIVE_CHECKLIST_ITEMS, copyChecklistModel, createChecklistItem, setChecklistItemActive, setChecklistItemCondition } from "@/modules/checklists";
import { createServiceField } from "@/modules/service-fields";
import { createService } from "@/modules/services";

// SPEC 2026-11-08-atendimento-dia-a-dia, 13.1 item 2 (SF-225; CA-CHK-07; decision J2).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });

async function scenario() {
  const ti = await createDomainSector();
  const rh = await createDomainSector();
  const category = await createDomainCategory();
  const admin = await createDomainUser({ role: "ADMIN" });
  const gabi = await createDomainUser({ role: "MANAGER", sectorId: ti.id });
  actAs(admin);
  const make = (name: string, sectorId: string) => createService({ name: `${name} ${sectorId}`, description: name, categoryId: category.id, sectorId }, prisma);
  const notebook = await make("Notebook", ti.id);
  const desktop = await make("Desktop", ti.id);
  const vacation = await make("Férias", rh.id);
  const kind = await createServiceField(
    notebook.id,
    { label: "Modelo", helpText: null, type: "SELECT", isRequired: false, options: ["A", "B"], minValue: null, maxValue: null },
    prisma,
  );
  const install = await createChecklistItem(notebook.id, { text: "Instalar", isRequired: true });
  const battery = await createChecklistItem(notebook.id, { text: "Conferir bateria", isRequired: false });
  await setChecklistItemCondition(battery.id, { conditionFieldId: kind.id, conditionValue: "A" });
  const old = await createChecklistItem(notebook.id, { text: "Antigo", isRequired: true });
  await setChecklistItemActive(old.id, false);
  await createChecklistItem(vacation.id, { text: "Conferir saldo", isRequired: true });
  return { admin, gabi, notebook, desktop, vacation, install };
}

const model = (serviceId: string) =>
  prisma.serviceChecklistItem.findMany({
    where: { serviceId, isActive: true },
    orderBy: { position: "asc" },
    select: { text: true, isRequired: true, position: true, conditionFieldId: true },
  });

describe("copying another service's model (13.1 item 2; decision J2)", () => {
  it("adds the active items at the end, in order, without conditions, each in the audit trail", async () => {
    const { gabi, notebook, desktop } = await scenario();
    actAs(gabi);
    await createChecklistItem(desktop.id, { text: "Ligar o monitor", isRequired: true });

    await expect(copyChecklistModel(desktop.id, notebook.id)).resolves.toEqual({ added: 2 });
    expect(await model(desktop.id)).toEqual([
      { text: "Ligar o monitor", isRequired: true, position: 1, conditionFieldId: null },
      { text: "Instalar", isRequired: true, position: 2, conditionFieldId: null },
      { text: "Conferir bateria", isRequired: false, position: 3, conditionFieldId: null },
    ]);
    const created = await prisma.auditEntry.count({ where: { entityType: "CHECKLIST_ITEM", actorId: gabi.id, action: "CREATED" } });
    expect(created).toBe(3);
    // The source does not change.
    expect((await model(notebook.id)).map(({ text }) => text)).toEqual(["Instalar", "Conferir bateria"]);
  });

  it("refuses the same service, a service the person does not manage, a source without active items, and the limit", async () => {
    const { admin, gabi, notebook, desktop, vacation } = await scenario();
    actAs(gabi);
    await expect(copyChecklistModel(desktop.id, desktop.id)).rejects.toBeInstanceOf(ValidationError);
    await expect(copyChecklistModel(desktop.id, vacation.id)).rejects.toBeInstanceOf(ValidationError);
    await expect(copyChecklistModel(vacation.id, notebook.id)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(copyChecklistModel(notebook.id, desktop.id)).rejects.toBeInstanceOf(ValidationError);

    // 19 active items: copying 2 would make 21; nothing is added.
    actAs(admin);
    await prisma.serviceChecklistItem.createMany({
      data: Array.from({ length: MAX_ACTIVE_CHECKLIST_ITEMS - 1 }, (_, index) => ({ serviceId: desktop.id, text: `Item ${index + 1}`, isRequired: false, position: index + 1 })),
    });
    await expect(copyChecklistModel(desktop.id, notebook.id)).rejects.toBeInstanceOf(ValidationError);
    expect(await prisma.serviceChecklistItem.count({ where: { serviceId: desktop.id } })).toBe(MAX_ACTIVE_CHECKLIST_ITEMS - 1);

    // The administrator copies across sectors.
    await prisma.serviceChecklistItem.deleteMany({ where: { serviceId: desktop.id } });
    await expect(copyChecklistModel(desktop.id, vacation.id)).resolves.toEqual({ added: 1 });
  });
});
