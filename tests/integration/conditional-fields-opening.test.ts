import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-03-campos-condicionais-atendimento, 5.1, 5.2 and 5.4 (SF-135; CA-CND-04 and 05).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});
import { createRequest } from "@/modules/requests";
import { createServiceField, FieldAnswersError, listPublishedServiceFields } from "@/modules/service-fields";

function actAs(user: User) {
  session.getCurrentUser.mockResolvedValue({ id: user.id, name: user.name, email: user.email, role: user.role, sectorId: user.sectorId, isActive: user.isActive });
}

const base = { helpText: null, isRequired: true, options: [] as string[], minValue: null, maxValue: null };

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const admin = await createDomainUser({ role: "ADMIN" });
  const rita = await createDomainUser({ role: "REQUESTER" });
  actAs(admin);
  const kind = await createServiceField(service.id, { ...base, label: "Tipo", type: "SELECT", options: ["Notebook", "Desktop"] }, prisma);
  const devices = await createServiceField(service.id, { ...base, label: "Acessórios", type: "MULTI_SELECT", options: ["Mouse", "Teclado", "Monitor"] }, prisma);
  const charger = await createServiceField(service.id, { ...base, label: "Carregador", type: "SHORT_TEXT", conditionFieldId: kind.id, conditionValue: "Notebook" }, prisma);
  const monitor = await createServiceField(service.id, { ...base, label: "Qual monitor", type: "SHORT_TEXT", conditionFieldId: devices.id, conditionValue: "Monitor" }, prisma);
  const order = await createServiceField(service.id, { ...base, label: "Ordem de serviço", type: "SHORT_TEXT", audience: "ATTENDANT" }, prisma);
  actAs(rita);
  return { service, rita, kind, devices, charger, monitor, order };
}

const answers = (requestId: string) =>
  prisma.requestFieldValue.findMany({ where: { requestId }, orderBy: { positionSnapshot: "asc" }, select: { labelSnapshot: true, value: true } });

async function refusal(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    if (error instanceof FieldAnswersError) return { reason: error.reason, errors: error.fieldErrors.map(({ code }) => code) };
    throw error;
  }
  throw new Error("not refused");
}

describe("opening with multiple choice and conditions (SF-135)", () => {
  it("shows only the requester's fields, with their conditions (5.4.2)", async () => {
    const { service, kind, order } = await scenario();
    const fields = await listPublishedServiceFields(service.id);
    expect(fields.map(({ label }) => label)).toEqual(["Tipo", "Acessórios", "Carregador", "Qual monitor"]);
    expect(fields.find(({ label }) => label === "Carregador")).toMatchObject({ conditionFieldId: kind.id, conditionValue: "Notebook" });
    expect(fields.some(({ id }) => id === order.id)).toBe(false);
  });

  it("stores the chosen options in order and asks for the fields whose condition is met (CA-CND-04 and 05)", async () => {
    const { service, kind, devices, charger, monitor } = await scenario();
    const open = (fieldValues: Record<string, string | string[]>) => createRequest({ serviceId: service.id, description: "Notebook novo", fieldValues }, prisma);

    // Notebook and Monitor chosen: both conditional fields are required.
    expect(await refusal(() => open({ [kind.id]: "Notebook", [devices.id]: ["Monitor", "Mouse"] }))).toEqual({
      reason: "invalid",
      errors: ["required", "required"],
    });
    const request = await open({ [kind.id]: "Notebook", [devices.id]: ["Monitor", "Mouse"], [charger.id]: "65 W", [monitor.id]: "LG 24" });
    await expect(answers(request.id)).resolves.toEqual([
      { labelSnapshot: "Tipo", value: "Notebook" },
      { labelSnapshot: "Acessórios", value: '["Mouse","Monitor"]' },
      { labelSnapshot: "Carregador", value: "65 W" },
      { labelSnapshot: "Qual monitor", value: "LG 24" },
    ]);

    // Desktop and no monitor: the values typed for the hidden fields are discarded (5.2.5).
    const hidden = await open({ [kind.id]: "Desktop", [devices.id]: "Teclado", [charger.id]: "65 W", [monitor.id]: "LG 24" });
    await expect(answers(hidden.id)).resolves.toEqual([
      { labelSnapshot: "Tipo", value: "Desktop" },
      { labelSnapshot: "Acessórios", value: '["Teclado"]' },
    ]);

    // Required multiple choice without options, unknown and repeated options.
    for (const chosen of [[], ["Impressora"], ["Mouse", "Mouse"]]) {
      expect(await refusal(() => open({ [kind.id]: "Desktop", [devices.id]: chosen })), JSON.stringify(chosen)).toMatchObject({ reason: "invalid" });
    }
  });

  it("refuses an answer for an attendance field as an out-of-date form (5.4.4)", async () => {
    const { service, kind, devices, order } = await scenario();
    expect(
      await refusal(() =>
        createRequest({ serviceId: service.id, description: "x", fieldValues: { [kind.id]: "Desktop", [devices.id]: "Mouse", [order.id]: "OS-1" } }, prisma),
      ),
    ).toEqual({ reason: "stale_form", errors: [] });
  });
});
