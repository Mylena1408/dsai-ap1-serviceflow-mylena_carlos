import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { ConflictError, ValidationError } from "@/server/errors";
import { createDomainCategory, createDomainSector, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { createChecklistItem, listServiceChecklists, setChecklistItemActive, setChecklistItemCondition } from "@/modules/checklists";
import { createServiceField, deactivateServiceField, updateServiceField } from "@/modules/service-fields";
import { createService } from "@/modules/services";
import { assumeRequest, createRequest, transitionRequestStatus } from "@/modules/requests";

// SPEC 2026-11-08-atendimento-dia-a-dia, 13.1 item 1 (SF-224; CA-CHK-06; decision J1).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
const field = (label: string, type: "SELECT" | "SHORT_TEXT" | "YES_NO", options: string[] = []) => ({
  label,
  helpText: null,
  type,
  isRequired: false,
  options,
  minValue: null,
  maxValue: null,
});

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const admin = await createDomainUser({ role: "ADMIN" });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  actAs(admin);
  const service = await createService({ name: `Instalação ${sector.id}`, description: "Instalação", categoryId: category.id, sectorId: sector.id }, prisma);
  const other = await createService({ name: `Outro ${sector.id}`, description: "Outro", categoryId: category.id, sectorId: sector.id }, prisma);
  const kind = await createServiceField(service.id, field("Equipamento", "SELECT", ["Notebook", "Desktop"]), prisma);
  const note = await createServiceField(service.id, field("Obs", "SHORT_TEXT"), prisma);
  const foreign = await createServiceField(other.id, field("Tipo", "SELECT", ["A", "B"]), prisma);
  const item = await createChecklistItem(service.id, { text: "Conferir bateria", isRequired: true });
  return { admin, rita, ana, service, kind, note, foreign, item };
}

describe("an item's condition (13.1 item 1; decision J1)", () => {
  it("follows the stages' rule and enters the audit trail", async () => {
    const { kind, note, foreign, item } = await scenario();

    for (const condition of [
      { conditionFieldId: note.id, conditionValue: "x" },
      { conditionFieldId: kind.id, conditionValue: "Tablet" },
      { conditionFieldId: foreign.id, conditionValue: "A" },
      { conditionFieldId: kind.id, conditionValue: null },
    ]) {
      await expect(setChecklistItemCondition(item.id, condition)).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(setChecklistItemCondition(item.id, { conditionFieldId: kind.id, conditionValue: "Notebook" })).resolves.toMatchObject({
      conditionFieldId: kind.id,
      conditionValue: "Notebook",
    });

    const [view] = (await listServiceChecklists()).filter(({ items }) => items.some(({ id }) => id === item.id));
    // Only fields with choices of the requester's form may be a condition.
    expect(view.conditionFields.map(({ label, values }) => [label, values])).toEqual([["Equipamento", ["Notebook", "Desktop"]]]);

    const entry = await prisma.auditEntry.findFirstOrThrow({ where: { entityType: "CHECKLIST_ITEM", entityId: item.id, action: "UPDATED" } });
    expect(entry.changes).toEqual([
      { field: "conditionFieldId", before: null, after: kind.id },
      { field: "conditionValue", before: null, after: "Notebook" },
    ]);

    await setChecklistItemCondition(item.id, { conditionFieldId: null, conditionValue: null });
    await expect(prisma.serviceChecklistItem.findUniqueOrThrow({ where: { id: item.id } })).resolves.toMatchObject({ conditionFieldId: null });
  });

  it("the copy follows the answer (CA-CHK-06)", async () => {
    const { rita, ana, service, kind, item } = await scenario();
    await setChecklistItemCondition(item.id, { conditionFieldId: kind.id, conditionValue: "Notebook" });
    actAs(rita);
    const laptop = await createRequest({ serviceId: service.id, description: "Notebook", fieldValues: { [kind.id]: "Notebook" } }, prisma);
    const desktop = await createRequest({ serviceId: service.id, description: "Desktop", fieldValues: { [kind.id]: "Desktop" } }, prisma);
    actAs(ana);
    for (const { id } of [laptop, desktop]) {
      await assumeRequest({ requestId: id }, prisma);
      await transitionRequestStatus({ requestId: id, toStatus: "IN_PROGRESS" }, prisma);
    }
    expect(await prisma.requestChecklistItem.count({ where: { requestId: laptop.id } })).toBe(1);
    expect(await prisma.requestChecklistItem.count({ where: { requestId: desktop.id } })).toBe(0);
  });

  it("keeps its field: not deactivated, its value kept among the options; an item is reactivated only with the field active", async () => {
    const { kind, item } = await scenario();
    await setChecklistItemCondition(item.id, { conditionFieldId: kind.id, conditionValue: "Notebook" });

    await expect(deactivateServiceField(kind.id, prisma)).rejects.toBeInstanceOf(ConflictError);
    await expect(updateServiceField(kind.id, field("Equipamento", "SELECT", ["Desktop", "Tablet"]), prisma)).rejects.toBeInstanceOf(ConflictError);

    // Inactive, the item frees the field.
    await setChecklistItemActive(item.id, false);
    await deactivateServiceField(kind.id, prisma);
    await expect(setChecklistItemActive(item.id, true)).rejects.toBeInstanceOf(ConflictError);
  });
});
