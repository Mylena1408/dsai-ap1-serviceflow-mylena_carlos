import { describe, expect, it } from "vitest";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-08-atendimento-dia-a-dia, 4.4 and 13.1 (SF-200; CA-CHK-05 and the rules of 4.3 by the database).

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const other = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const request = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: sector.id });
  return { service, other, ana, request };
}

describe("checklists in the database (4.4)", () => {
  it("a model item has a text of 1 to 120 characters without spaces at the ends and a whole condition", async () => {
    const { service } = await scenario();
    const field = await prisma.serviceField.create({
      data: { serviceId: service.id, label: "Equipamento", type: "SELECT", isRequired: true, options: ["Notebook", "Desktop"], position: 0 },
    });
    const base = { serviceId: service.id, isRequired: true, position: 1 };

    await expect(prisma.serviceChecklistItem.create({ data: { ...base, text: "Conferir cabo" } })).resolves.toMatchObject({ isActive: true });
    await expect(
      prisma.serviceChecklistItem.create({ data: { ...base, text: "Se notebook", conditionFieldId: field.id, conditionValue: "Notebook" } }),
    ).resolves.toMatchObject({ conditionValue: "Notebook" });

    for (const data of [
      { ...base, text: "" },
      { ...base, text: " Espaço" },
      { ...base, text: "x".repeat(121) },
      { ...base, text: "Posição", position: 0 },
      { ...base, text: "Meia condição", conditionFieldId: field.id },
      { ...base, text: "Meia condição", conditionValue: "Notebook" },
      { ...base, text: "Valor vazio", conditionFieldId: field.id, conditionValue: "" },
      { ...base, text: "Valor longo", conditionFieldId: field.id, conditionValue: "x".repeat(81) },
    ]) {
      await expect(prisma.serviceChecklistItem.create({ data })).rejects.toThrow(/ServiceChecklistItem_values_check/);
    }
  });

  it("the condition uses a field of the same service (13.1 item 1)", async () => {
    const { service, other } = await scenario();
    const foreign = await prisma.serviceField.create({
      data: { serviceId: other.id, label: "Tipo", type: "SELECT", isRequired: true, options: ["A", "B"], position: 0 },
    });

    await expect(
      prisma.serviceChecklistItem.create({
        data: { serviceId: service.id, text: "Outro serviço", isRequired: false, position: 1, conditionFieldId: foreign.id, conditionValue: "A" },
      }),
    ).rejects.toThrow(/ServiceChecklistItem_condition_same_service_fkey/);
  });

  it("a request's item is marked with who and when, and an optional note; its position is unique", async () => {
    const { service, ana, request } = await scenario();
    const model = await prisma.serviceChecklistItem.create({ data: { serviceId: service.id, text: "Instalar", isRequired: true, position: 1 } });
    const now = new Date();

    await prisma.requestChecklist.create({ data: { requestId: request.id, copiedAt: now } });
    await expect(prisma.requestChecklist.create({ data: { requestId: request.id, copiedAt: now } })).rejects.toMatchObject({ code: "P2002" });
    const item = await prisma.requestChecklistItem.create({
      data: { requestId: request.id, templateItemId: model.id, textSnapshot: model.text, isRequired: true, position: 1 },
    });
    await expect(
      prisma.requestChecklistItem.create({ data: { requestId: request.id, textSnapshot: "Outro", isRequired: false, position: 1 } }),
    ).rejects.toMatchObject({ code: "P2002" });

    await expect(prisma.requestChecklistItem.update({ where: { id: item.id }, data: { doneAt: now, doneById: ana.id, note: "Feito" } })).resolves.toMatchObject({
      note: "Feito",
    });
    for (const data of [
      { doneAt: null },
      { doneById: null },
      { note: "" },
      { note: "x".repeat(201) },
    ]) {
      await expect(prisma.requestChecklistItem.update({ where: { id: item.id }, data })).rejects.toThrow(/RequestChecklistItem_values_check/);
    }
    await expect(
      prisma.requestChecklistItem.update({ where: { id: item.id }, data: { doneAt: null, doneById: null, note: "Sem marca" } }),
    ).rejects.toThrow(/RequestChecklistItem_values_check/);
    await expect(
      prisma.requestChecklistItem.create({ data: { requestId: request.id, textSnapshot: "x".repeat(121), isRequired: false, position: 2 } }),
    ).rejects.toThrow(/RequestChecklistItem_values_check/);

    await prisma.requestChecklistEvent.create({ data: { requestId: request.id, itemId: item.id, action: "DONE", note: "Feito", actorId: ana.id, occurredAt: now } });
    await expect(
      prisma.requestChecklistEvent.create({ data: { requestId: request.id, itemId: item.id, action: "UNDONE", note: "", actorId: ana.id, occurredAt: now } }),
    ).rejects.toThrow(/RequestChecklistEvent_note_check/);

    // A model item in use is never deleted: it is deactivated, and the copy keeps its text (decision I7).
    await expect(prisma.serviceChecklistItem.delete({ where: { id: model.id } })).rejects.toThrow();
    await prisma.serviceChecklistItem.update({ where: { id: model.id }, data: { text: "Instalar e testar" } });
    expect(await prisma.requestChecklistItem.findUniqueOrThrow({ where: { id: item.id }, select: { textSnapshot: true } })).toEqual({
      textSnapshot: "Instalar",
    });
  });
});
