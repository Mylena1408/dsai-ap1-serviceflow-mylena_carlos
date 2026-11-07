import { describe, expect, it } from "vitest";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";
import { createPrismaServiceFieldRepository } from "@/modules/service-fields/infrastructure/prisma-service-field-repository";

// SPEC 2026-11-06-aprofundamento-configurabilidade, 3.4 (SF-161; CA-CMP-06 for the schema).

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const field = (data: Record<string, unknown>) =>
    prisma.serviceField.create({
      data: { serviceId: service.id, label: `Campo ${Math.random()}`, type: "SHORT_TEXT", isRequired: false, options: [], position: 0, ...data },
    });
  return { sector, service, field };
}

describe("decimal and formatted fields schema (SF-161)", () => {
  it("keeps existing and new non-decimal fields without places or decimal limits", async () => {
    const { field } = await scenario();

    await expect(field({})).resolves.toMatchObject({ decimalPlaces: null, minDecimal: null, maxDecimal: null });
    for (const type of ["EMAIL", "PHONE", "CPF", "CNPJ", "CEP"] as const) {
      await expect(field({ type })).resolves.toMatchObject({ type });
    }
  });

  it("requires 1 to 4 places exactly on decimal fields", async () => {
    const { field } = await scenario();

    await expect(field({ type: "DECIMAL", decimalPlaces: 2 })).resolves.toMatchObject({ decimalPlaces: 2 });
    await expect(field({ type: "DECIMAL" })).rejects.toThrow();
    await expect(field({ type: "DECIMAL", decimalPlaces: 0 })).rejects.toThrow();
    await expect(field({ type: "DECIMAL", decimalPlaces: 5 })).rejects.toThrow();
    await expect(field({ type: "INTEGER", decimalPlaces: 2 })).rejects.toThrow();
  });

  it("accepts decimal limits only on decimal fields, within the bound, with the field's places and min <= max", async () => {
    const { field } = await scenario();

    await expect(field({ type: "DECIMAL", decimalPlaces: 2, minDecimal: "-1000000000", maxDecimal: "1000000000" })).resolves.toBeTruthy();
    await expect(field({ type: "DECIMAL", decimalPlaces: 2, minDecimal: "10.5", maxDecimal: "10.5" })).resolves.toBeTruthy();
    await expect(field({ type: "DECIMAL", decimalPlaces: 2, minDecimal: "10.51", maxDecimal: "10.5" })).rejects.toThrow();
    await expect(field({ type: "DECIMAL", decimalPlaces: 2, minDecimal: "0.001" })).rejects.toThrow();
    await expect(field({ type: "DECIMAL", decimalPlaces: 4, maxDecimal: "1000000000.0001" })).rejects.toThrow();
    await expect(field({ type: "INTEGER", maxDecimal: "1" })).rejects.toThrow();
    await expect(field({ type: "SHORT_TEXT", minDecimal: "1" })).rejects.toThrow();
  });

  it("reads the decimal limits as text with the field's places", async () => {
    const { service, field } = await scenario();
    await field({ type: "DECIMAL", decimalPlaces: 2, minDecimal: "0", maxDecimal: "1500.5", label: "Valor" });
    await field({ type: "DECIMAL", decimalPlaces: 3, label: "Peso", position: 1 });

    const fields = await createPrismaServiceFieldRepository(prisma).listActiveForService(service.id);

    expect(fields.map(({ label, decimalPlaces, minDecimal, maxDecimal }) => ({ label, decimalPlaces, minDecimal, maxDecimal }))).toEqual([
      { label: "Valor", decimalPlaces: 2, minDecimal: "0.00", maxDecimal: "1500.50" },
      { label: "Peso", decimalPlaces: 3, minDecimal: null, maxDecimal: null },
    ]);
  });

  it("stores answers of the new types with their snapshot", async () => {
    const { sector, service, field } = await scenario();
    const requester = await createDomainUser({ role: "REQUESTER" });
    const request = await createDomainRequest({ requesterId: requester.id, serviceId: service.id, sectorId: sector.id });
    const cpf = await field({ type: "CPF" });
    const price = await field({ type: "DECIMAL", decimalPlaces: 2, position: 1 });

    await prisma.requestFieldValue.createMany({
      data: [
        { requestId: request.id, fieldId: cpf.id, labelSnapshot: "CPF", typeSnapshot: "CPF", positionSnapshot: 0, value: "52998224725" },
        { requestId: request.id, fieldId: price.id, labelSnapshot: "Valor", typeSnapshot: "DECIMAL", positionSnapshot: 1, value: "10.50" },
      ],
    });

    const stored = await prisma.requestFieldValue.findMany({ where: { requestId: request.id }, orderBy: { positionSnapshot: "asc" } });
    expect(stored.map(({ typeSnapshot, value }) => ({ typeSnapshot, value }))).toEqual([
      { typeSnapshot: "CPF", value: "52998224725" },
      { typeSnapshot: "DECIMAL", value: "10.50" },
    ]);
  });
});
