import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-06-aprofundamento-configurabilidade, 3.3 over the database (SF-162; CA-CMP-01 to 04).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { assumeRequest, createRequest, saveAttendanceFields, transitionRequestStatus } from "@/modules/requests";
import { createServiceField, FieldAnswersError, updateServiceField } from "@/modules/service-fields";
import { ValidationError } from "@/server/errors";

function actAs(user: User) {
  session.getCurrentUser.mockResolvedValue({ id: user.id, name: user.name, email: user.email, role: user.role, sectorId: user.sectorId, isActive: user.isActive });
}

const base = { helpText: null, isRequired: false, options: [] as string[], minValue: null, maxValue: null };

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const admin = await createDomainUser({ role: "ADMIN" });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  actAs(admin);
  const price = await createServiceField(
    service.id,
    { ...base, label: "Valor estimado", type: "DECIMAL", isRequired: true, decimalPlaces: 2, minDecimal: "0", maxDecimal: "1500,5" },
    prisma,
  );
  const cpf = await createServiceField(service.id, { ...base, label: "CPF", type: "CPF", isRequired: true }, prisma);
  const email = await createServiceField(service.id, { ...base, label: "E-mail", type: "EMAIL" }, prisma);
  const phone = await createServiceField(service.id, { ...base, label: "Telefone", type: "PHONE" }, prisma);
  const cnpj = await createServiceField(service.id, { ...base, label: "CNPJ", type: "CNPJ" }, prisma);
  const cep = await createServiceField(service.id, { ...base, label: "CEP", type: "CEP" }, prisma);
  const weight = await createServiceField(
    service.id,
    { ...base, label: "Peso medido", type: "DECIMAL", decimalPlaces: 3, audience: "ATTENDANT" },
    prisma,
  );
  return { sector, service, admin, rita, ana, price, cpf, email, phone, cnpj, cep, weight };
}

async function refusal(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    if (error instanceof FieldAnswersError) return error.fieldErrors.map(({ code }) => code);
    throw error;
  }
  throw new Error("not refused");
}

const answers = (requestId: string) =>
  prisma.requestFieldValue.findMany({
    where: { requestId },
    orderBy: { positionSnapshot: "asc" },
    select: { labelSnapshot: true, typeSnapshot: true, value: true },
  });

describe("decimal and formatted fields over the database (SF-162)", () => {
  it("lets the administrator configure decimals, normalizing the limits and recording them in the audit (CA-CMP-01)", async () => {
    const { service, admin, price } = await scenario();
    expect(price).toMatchObject({ type: "DECIMAL", decimalPlaces: 2, minDecimal: "0.00", maxDecimal: "1500.50" });

    actAs(admin);
    const changed = await updateServiceField(
      price.id,
      { ...base, label: "Valor estimado", type: "DECIMAL", isRequired: true, decimalPlaces: 3, minDecimal: "-10", maxDecimal: null },
      prisma,
    );
    expect(changed).toMatchObject({ decimalPlaces: 3, minDecimal: "-10.000", maxDecimal: null });

    const entry = await prisma.auditEntry.findFirstOrThrow({ where: { entityId: price.id, action: "UPDATED" } });
    expect(entry.changes).toEqual(
      expect.arrayContaining([
        { field: "decimalPlaces", before: 2, after: 3 },
        { field: "minDecimal", before: "0.00", after: "-10.000" },
        { field: "maxDecimal", before: "1500.50", after: null },
      ]),
    );

    const invalid = (input: Record<string, unknown>) =>
      createServiceField(service.id, { ...base, label: `Outro ${Math.random()}`, type: "DECIMAL", ...input }, prisma);
    await expect(invalid({})).rejects.toThrow(ValidationError);
    await expect(invalid({ decimalPlaces: 5 })).rejects.toThrow(ValidationError);
    // The path survives the public filter, so the form shows the decimal message.
    await expect(invalid({ decimalPlaces: 5 })).rejects.toMatchObject({ issues: [expect.objectContaining({ path: ["decimalPlaces"] })] });
    await expect(invalid({ decimalPlaces: 2, minDecimal: "0,001" })).rejects.toThrow(ValidationError);
    await expect(invalid({ decimalPlaces: 2, minDecimal: "10", maxDecimal: "9" })).rejects.toThrow(ValidationError);
    await expect(
      createServiceField(service.id, { ...base, label: "Inteiro", type: "INTEGER", decimalPlaces: 2 }, prisma),
    ).rejects.toThrow(ValidationError);
  });

  it("does not accept a formatted or decimal field as the controller of a condition (CA-CMP-04)", async () => {
    const { service, admin, cpf, price } = await scenario();
    actAs(admin);

    for (const controller of [cpf, price]) {
      await expect(
        createServiceField(
          service.id,
          { ...base, label: `Dependente ${controller.label}`, type: "SHORT_TEXT", conditionFieldId: controller.id, conditionValue: "1" },
          prisma,
        ),
      ).rejects.toThrow(ValidationError);
    }
  });

  it("stores the opening answers normalized and refuses invalid ones with fixed codes (CA-CMP-02 and 03)", async () => {
    const { service, rita, price, cpf, email, phone, cnpj, cep } = await scenario();
    actAs(rita);
    const open = (fieldValues: Record<string, string>) => createRequest({ serviceId: service.id, description: "Reembolso", fieldValues }, prisma);

    expect(
      await refusal(() =>
        open({ [price.id]: "1500,51", [cpf.id]: "529.982.247-24", [email.id]: "rita@exemplo", [phone.id]: "3201-7000", [cnpj.id]: "11.222.333/0001-80", [cep.id]: "6607" }),
      ),
    ).toEqual(["out_of_range", "invalid_cpf", "invalid_email", "invalid_phone", "invalid_cnpj", "invalid_cep"]);
    expect(await refusal(() => open({ [price.id]: "10,255", [cpf.id]: "529.982.247-25" }))).toEqual(["too_many_decimals"]);

    const request = await open({
      [price.id]: "1234,5",
      [cpf.id]: "529.982.247-25",
      [email.id]: "Rita@Exemplo.com.br",
      [phone.id]: "+55 (91) 98765-4321",
      [cnpj.id]: "11.222.333/0001-81",
      [cep.id]: "66075-110",
    });
    await expect(answers(request.id)).resolves.toEqual([
      { labelSnapshot: "Valor estimado", typeSnapshot: "DECIMAL", value: "1234.50" },
      { labelSnapshot: "CPF", typeSnapshot: "CPF", value: "52998224725" },
      { labelSnapshot: "E-mail", typeSnapshot: "EMAIL", value: "rita@exemplo.com.br" },
      { labelSnapshot: "Telefone", typeSnapshot: "PHONE", value: "91987654321" },
      { labelSnapshot: "CNPJ", typeSnapshot: "CNPJ", value: "11222333000181" },
      { labelSnapshot: "CEP", typeSnapshot: "CEP", value: "66075110" },
    ]);
  });

  it("validates a decimal filled during the attendance (CA-CMP-02)", async () => {
    const { service, rita, ana, price, cpf, weight } = await scenario();
    actAs(rita);
    const request = await createRequest({ serviceId: service.id, description: "Pesar", fieldValues: { [price.id]: "1", [cpf.id]: "52998224725" } }, prisma);
    actAs(ana);
    await assumeRequest({ requestId: request.id }, prisma);
    await transitionRequestStatus({ requestId: request.id, toStatus: "IN_PROGRESS" }, prisma);

    await expect(saveAttendanceFields({ requestId: request.id, values: { [weight.id]: "2,5001" } }, prisma)).rejects.toThrow(FieldAnswersError);
    await saveAttendanceFields({ requestId: request.id, values: { [weight.id]: "2,5" } }, prisma);
    const saved = await prisma.requestFieldValue.findFirstOrThrow({ where: { requestId: request.id, fieldId: weight.id } });
    expect(saved.value).toBe("2.500");
  });
});
