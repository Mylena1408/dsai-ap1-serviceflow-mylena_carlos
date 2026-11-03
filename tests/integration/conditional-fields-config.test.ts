import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./fixtures";
import { ConflictError, ValidationError } from "@/server/errors";
import { createDomainCategory, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-03-campos-condicionais-atendimento, 5.1 to 5.4 and 5.7 (SF-134; CA-CND-02 and 03).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { createServiceField, deactivateServiceField, reactivateServiceField, updateServiceField } from "@/modules/service-fields";

function actAs(user: User) {
  session.getCurrentUser.mockResolvedValue({ id: user.id, name: user.name, email: user.email, role: user.role, sectorId: user.sectorId, isActive: user.isActive });
}

const base = { helpText: null, isRequired: false, options: [] as string[], minValue: null, maxValue: null };

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const other = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const admin = await createDomainUser({ role: "ADMIN" });
  actAs(admin);
  const kind = await createServiceField(service.id, { ...base, label: "Tipo", type: "SELECT", options: ["Notebook", "Desktop"], isRequired: true }, prisma);
  return { service, other, kind };
}

describe("configuring multiple choice, audience and conditions (SF-134)", () => {
  it("creates a multiple choice, an attendance field and conditional fields (CA-CND-02)", async () => {
    const { service, kind } = await scenario();

    const devices = await createServiceField(service.id, { ...base, label: "Equipamentos", type: "MULTI_SELECT", options: ["Mouse", "Teclado"] }, prisma);
    const charger = await createServiceField(
      service.id,
      { ...base, label: "Carregador", type: "SHORT_TEXT", conditionFieldId: kind.id, conditionValue: "Notebook" },
      prisma,
    );
    const monitor = await createServiceField(
      service.id,
      { ...base, label: "Qual monitor", type: "SHORT_TEXT", conditionFieldId: devices.id, conditionValue: "Teclado" },
      prisma,
    );
    const order = await createServiceField(service.id, { ...base, label: "Ordem de serviço", type: "SHORT_TEXT", audience: "ATTENDANT", isRequired: true }, prisma);

    expect(devices).toMatchObject({ type: "MULTI_SELECT", audience: "REQUESTER" });
    expect(charger).toMatchObject({ conditionFieldId: kind.id, conditionValue: "Notebook" });
    expect(monitor).toMatchObject({ conditionFieldId: devices.id });
    expect(order).toMatchObject({ audience: "ATTENDANT", conditionFieldId: null });

    // Editing without the new keys keeps them; an empty condition removes it.
    await expect(updateServiceField(charger.id, { ...base, label: "Carregador do notebook", type: "SHORT_TEXT" }, prisma)).resolves.toMatchObject({
      conditionFieldId: kind.id,
    });
    await expect(
      updateServiceField(charger.id, { ...base, label: "Carregador", type: "SHORT_TEXT", conditionFieldId: null, conditionValue: null }, prisma),
    ).resolves.toMatchObject({ conditionFieldId: null, conditionValue: null });
  });

  it("refuses controllers and values the rules do not accept (CA-CND-02)", async () => {
    const { service, other, kind } = await scenario();
    const free = await createServiceField(service.id, { ...base, label: "Observação", type: "SHORT_TEXT" }, prisma);
    const order = await createServiceField(service.id, { ...base, label: "Ordem", type: "YES_NO", audience: "ATTENDANT" }, prisma);
    const dependent = await createServiceField(service.id, { ...base, label: "Dependente", type: "YES_NO", conditionFieldId: kind.id, conditionValue: "Notebook" }, prisma);
    const elsewhere = await createServiceField(other.id, { ...base, label: "Outro", type: "YES_NO" }, prisma);
    const inactive = await createServiceField(service.id, { ...base, label: "Inativo", type: "YES_NO" }, prisma);
    await deactivateServiceField(inactive.id, prisma);
    const create = (conditionFieldId: string, conditionValue: string) =>
      createServiceField(service.id, { ...base, label: `Novo ${Math.random()}`, type: "SHORT_TEXT", conditionFieldId, conditionValue }, prisma);

    for (const [controller, value] of [
      [free.id, "x"],
      [order.id, "true"],
      [dependent.id, "true"],
      [elsewhere.id, "true"],
      [inactive.id, "true"],
    ] as const) {
      await expect(create(controller, value), controller).rejects.toThrow(ValidationError);
    }
    await expect(create(kind.id, "Tablet")).rejects.toThrow(ValidationError);
    // A field is not its own controller.
    await expect(
      updateServiceField(order.id, { ...base, label: "Ordem", type: "YES_NO", conditionFieldId: order.id, conditionValue: "true" }, prisma),
    ).rejects.toThrow(ValidationError);
    await expect(prisma.serviceField.count({ where: { serviceId: service.id, label: { startsWith: "Novo" } } })).resolves.toBe(0);
  });

  it("refuses the changes that would break a condition (CA-CND-03)", async () => {
    const { service, kind } = await scenario();
    const yes = await createServiceField(service.id, { ...base, label: "Tem defeito", type: "YES_NO" }, prisma);
    const dependent = await createServiceField(service.id, { ...base, label: "Carregador", type: "SHORT_TEXT", conditionFieldId: kind.id, conditionValue: "Notebook" }, prisma);
    const select = { ...base, label: "Tipo", type: "SELECT" as const, isRequired: true };

    // 1. deactivate a controller in use; 2. remove a used option; 4. give the controller a condition.
    await expect(deactivateServiceField(kind.id, prisma)).rejects.toThrow(ConflictError);
    await expect(updateServiceField(kind.id, { ...select, options: ["Desktop", "Tablet"] }, prisma)).rejects.toThrow(ConflictError);
    await expect(updateServiceField(kind.id, { ...select, options: ["Notebook", "Desktop"], conditionFieldId: yes.id, conditionValue: "true" }, prisma)).rejects.toThrow(
      ConflictError,
    );
    // The audience of a controller does not change under its dependents.
    await expect(updateServiceField(kind.id, { ...select, options: ["Notebook", "Desktop"], audience: "ATTENDANT" }, prisma)).rejects.toThrow(ConflictError);
    // Adding an option is fine.
    await expect(updateServiceField(kind.id, { ...select, options: ["Notebook", "Desktop", "Tablet"] }, prisma)).resolves.toMatchObject({
      options: ["Notebook", "Desktop", "Tablet"],
    });

    // 3. reactivate a dependent whose controller is inactive.
    await deactivateServiceField(dependent.id, prisma);
    await deactivateServiceField(kind.id, prisma);
    await expect(reactivateServiceField(dependent.id, prisma)).rejects.toThrow(ConflictError);
    await reactivateServiceField(kind.id, prisma);
    await expect(reactivateServiceField(dependent.id, prisma)).resolves.toMatchObject({ isActive: true });
  });
});
