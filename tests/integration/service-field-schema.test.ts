import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "./fixtures";
import {
  createDomainCategory,
  createDomainRequest,
  createDomainSector,
  createDomainService,
  createDomainUser,
} from "./domain-fixtures";

// SPEC 2026-11-01-campos-personalizados, section 6 (SF-071).

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const requester = await createDomainUser({ role: "REQUESTER" });
  const request = await createDomainRequest({ requesterId: requester.id, serviceId: service.id, sectorId: sector.id });
  return { service, request };
}

function fieldData(
  serviceId: string,
  overrides: Partial<Prisma.ServiceFieldUncheckedCreateInput> = {},
): Prisma.ServiceFieldUncheckedCreateInput {
  return {
    serviceId,
    label: "Patrimônio",
    type: "SHORT_TEXT",
    isRequired: true,
    options: [],
    position: 0,
    ...overrides,
  };
}

describe("custom field schema (SF-071)", () => {
  it("leaves existing services and requests without fields or answers (CA-FLD-10)", async () => {
    const { service, request } = await scenario();

    await expect(prisma.serviceField.count({ where: { serviceId: service.id } })).resolves.toBe(0);
    await expect(prisma.requestFieldValue.count({ where: { requestId: request.id } })).resolves.toBe(0);
  });

  it("keeps labels unique among active fields of a service, ignoring case", async () => {
    const { service } = await scenario();
    const other = await scenario();
    const first = await prisma.serviceField.create({ data: fieldData(service.id) });

    await expect(prisma.serviceField.create({ data: fieldData(service.id, { label: "PATRIMÔNIO" }) })).rejects.toThrow();
    await expect(prisma.serviceField.create({ data: fieldData(other.service.id) })).resolves.toBeTruthy();

    await prisma.serviceField.update({ where: { id: first.id }, data: { isActive: false } });
    await expect(prisma.serviceField.create({ data: fieldData(service.id, { position: 1 }) })).resolves.toBeTruthy();
  });

  it("checks label, help text and position", async () => {
    const { service } = await scenario();

    for (const overrides of [
      { label: "" },
      { label: " Patrimônio" },
      { label: "a".repeat(81) },
      { helpText: "" },
      { helpText: "a".repeat(201) },
      { position: -1 },
    ]) {
      await expect(prisma.serviceField.create({ data: fieldData(service.id, overrides) })).rejects.toThrow();
    }
    await expect(
      prisma.serviceField.create({ data: fieldData(service.id, { label: "a".repeat(80), helpText: "a".repeat(200) }) }),
    ).resolves.toBeTruthy();
  });

  it("allows options only on list fields, 2 to 20, trimmed and distinct", async () => {
    const { service } = await scenario();
    const list = (options: string[], label = `Lista ${options.length}`) =>
      prisma.serviceField.create({ data: fieldData(service.id, { type: "SELECT", options, label }) });

    await expect(list(["Manhã"])).rejects.toThrow();
    await expect(list(Array.from({ length: 21 }, (_, index) => `Opção ${index}`))).rejects.toThrow();
    await expect(list(["Manhã", "manhã"], "Repetida")).rejects.toThrow();
    await expect(list(["Manhã", " Tarde"], "Espaço")).rejects.toThrow();
    await expect(list(["Manhã", "a".repeat(81)], "Longa")).rejects.toThrow();
    await expect(list([])).rejects.toThrow();
    await expect(
      prisma.serviceField.create({ data: fieldData(service.id, { options: ["Manhã", "Tarde"] }) }),
    ).rejects.toThrow();
    await expect(list(["Manhã", "Tarde"])).resolves.toBeTruthy();
    await expect(list(Array.from({ length: 20 }, (_, index) => `Opção ${index}`))).resolves.toBeTruthy();
  });

  it("allows limits only on integer fields, within one billion and with min <= max", async () => {
    const { service } = await scenario();
    const integer = (minValue: number | null, maxValue: number | null, label: string) =>
      prisma.serviceField.create({ data: fieldData(service.id, { type: "INTEGER", minValue, maxValue, label }) });

    await expect(integer(2, 1, "Invertido")).rejects.toThrow();
    await expect(integer(-1_000_000_001, null, "Abaixo")).rejects.toThrow();
    await expect(integer(null, 1_000_000_001, "Acima")).rejects.toThrow();
    await expect(
      prisma.serviceField.create({ data: fieldData(service.id, { type: "DATE", minValue: 1, label: "Data" }) }),
    ).rejects.toThrow();
    await expect(integer(1, 1, "Igual")).resolves.toBeTruthy();
    await expect(integer(-1_000_000_000, 1_000_000_000, "Bordas")).resolves.toBeTruthy();
  });

  it("stores one answer per field and request, with a snapshot and a non-empty value", async () => {
    const { service, request } = await scenario();
    const field = await prisma.serviceField.create({ data: fieldData(service.id) });
    const answer = (value: string, labelSnapshot = "Patrimônio") =>
      prisma.requestFieldValue.create({
        data: {
          requestId: request.id,
          fieldId: field.id,
          labelSnapshot,
          typeSnapshot: "SHORT_TEXT",
          positionSnapshot: 0,
          value,
        },
      });

    await expect(answer("")).rejects.toThrow();
    await expect(answer("a".repeat(2001))).rejects.toThrow();
    await expect(answer("1234", "")).rejects.toThrow();
    await expect(answer("a".repeat(2000))).resolves.toBeTruthy();
    await expect(answer("5678")).rejects.toThrow();

    // Answered fields cannot be deleted, only deactivated (section 5.1).
    await expect(prisma.serviceField.delete({ where: { id: field.id } })).rejects.toThrow();
  });
});
