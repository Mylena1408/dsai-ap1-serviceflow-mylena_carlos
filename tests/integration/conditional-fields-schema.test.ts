import { describe, expect, it } from "vitest";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-03-campos-condicionais-atendimento, section 6 (SF-133).

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const other = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const field = (data: Record<string, unknown>) =>
    prisma.serviceField.create({
      data: { serviceId: service.id, label: `Campo ${Math.random()}`, type: "SHORT_TEXT", isRequired: false, options: [], position: 0, ...data },
    });
  return { sector, service, other, field };
}

describe("conditional and attendance fields schema (SF-133)", () => {
  it("keeps existing fields as requester fields without a condition", async () => {
    const { field } = await scenario();
    await expect(field({})).resolves.toMatchObject({ audience: "REQUESTER", conditionFieldId: null, conditionValue: null });
  });

  it("accepts 2 to 20 options on a multiple choice", async () => {
    const { field } = await scenario();
    await expect(field({ type: "MULTI_SELECT", options: ["Mouse", "Teclado"] })).resolves.toMatchObject({ type: "MULTI_SELECT" });
    await expect(field({ type: "MULTI_SELECT", options: ["Mouse"] })).rejects.toThrow();
    await expect(field({ type: "MULTI_SELECT", options: [] })).rejects.toThrow();
  });

  it("keeps a condition complete, on another field of the same service", async () => {
    const { field, other } = await scenario();
    const controller = await field({ type: "SELECT", options: ["Notebook", "Desktop"] });

    await expect(field({ conditionFieldId: controller.id, conditionValue: "Notebook", audience: "ATTENDANT" })).resolves.toMatchObject({
      conditionFieldId: controller.id,
    });
    await expect(field({ conditionFieldId: controller.id })).rejects.toThrow();
    await expect(field({ conditionValue: "Notebook" })).rejects.toThrow();
    await expect(field({ conditionFieldId: controller.id, conditionValue: "" })).rejects.toThrow();
    // A controller of another service.
    await expect(field({ serviceId: other.id, conditionFieldId: controller.id, conditionValue: "Notebook" })).rejects.toThrow();
    // Pointing to itself.
    await expect(prisma.serviceField.update({ where: { id: controller.id }, data: { conditionFieldId: controller.id, conditionValue: "Notebook" } })).rejects.toThrow();
  });

  it("records who saved an attendance answer and the history line with 1 to 10 labels", async () => {
    const { sector, service, field } = await scenario();
    const requester = await createDomainUser({ role: "REQUESTER" });
    const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
    const request = await createDomainRequest({ requesterId: requester.id, serviceId: service.id, sectorId: sector.id });
    const order = await field({ audience: "ATTENDANT" });
    const value = (data: Record<string, unknown>) =>
      prisma.requestFieldValue.create({
        data: { requestId: request.id, fieldId: order.id, labelSnapshot: "OS", typeSnapshot: "SHORT_TEXT", positionSnapshot: 0, value: "OS-1", ...data },
      });

    await expect(value({ updatedAt: new Date() })).rejects.toThrow();
    await expect(value({ updatedById: ana.id })).rejects.toThrow();
    await expect(value({ updatedAt: new Date(), updatedById: ana.id })).resolves.toMatchObject({ updatedById: ana.id });

    const line = (labels: string[]) =>
      prisma.requestFieldUpdateEvent.create({ data: { requestId: request.id, actorId: ana.id, labels, occurredAt: new Date() } });
    await expect(line([])).rejects.toThrow();
    await expect(line(Array.from({ length: 11 }, (_, index) => `Campo ${index}`))).rejects.toThrow();
    await expect(line(["OS"])).resolves.toMatchObject({ labels: ["OS"] });
  });
});
