import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-01-campos-personalizados, sections 5.3 and 5.4 (SF-073; CA-FLD-04 to 08).

const authenticated = vi.hoisted(() => ({
  requireRequestCreator: vi.fn(),
  requirePublishedCatalogReader: vi.fn(),
}));

vi.mock("@/server/authorization", () => authenticated);

import { createRequest } from "@/modules/requests";
import { FieldAnswersError, listPublishedServiceFields } from "@/modules/service-fields";

async function scenario() {
  const requester = await createDomainUser({ role: "REQUESTER" });
  authenticated.requireRequestCreator.mockResolvedValue(requester);
  authenticated.requirePublishedCatalogReader.mockResolvedValue(requester);
  const category = await createDomainCategory();
  const sector = await createDomainSector();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const field = (data: Omit<Prisma.ServiceFieldUncheckedCreateInput, "serviceId">) =>
    prisma.serviceField.create({ data: { serviceId: service.id, ...data } });

  const asset = await field({ label: "Patrimônio", type: "SHORT_TEXT", isRequired: true, options: [], position: 0 });
  const quantity = await field({
    label: "Quantidade",
    type: "INTEGER",
    isRequired: false,
    options: [],
    minValue: 1,
    maxValue: 10,
    position: 1,
  });
  const date = await field({ label: "Data desejada", type: "DATE", isRequired: false, options: [], position: 2 });
  const shift = await field({ label: "Turno", type: "SELECT", isRequired: true, options: ["Manhã", "Tarde"], position: 3 });
  const urgent = await field({ label: "Urgente?", type: "YES_NO", isRequired: true, options: [], position: 4 });
  const notes = await field({ label: "Observações", type: "LONG_TEXT", isRequired: false, options: [], position: 5 });
  const inactive = await field({
    label: "Antigo",
    type: "SHORT_TEXT",
    isRequired: true,
    options: [],
    position: 6,
    isActive: false,
  });

  return { requester, service, asset, quantity, date, shift, urgent, notes, inactive };
}

async function countRows(serviceId: string) {
  const [requests, values, outbox] = await Promise.all([
    prisma.request.count({ where: { serviceId } }),
    prisma.requestFieldValue.count({ where: { request: { serviceId } } }),
    prisma.outboxEvent.count({ where: { request: { serviceId } } }),
  ]);
  return { requests, values, outbox };
}

describe("opening a request with custom fields (SF-073)", () => {
  it("lists only the active fields, in the configured order (CA-FLD-04)", async () => {
    const { service } = await scenario();

    const fields = await listPublishedServiceFields(service.id, prisma);

    expect(fields.map(({ label }) => label)).toEqual([
      "Patrimônio",
      "Quantidade",
      "Data desejada",
      "Turno",
      "Urgente?",
      "Observações",
    ]);
  });

  it("stores every type of answer with its snapshot in the opening transaction (CA-FLD-08)", async () => {
    const s = await scenario();

    const created = await createRequest(
      {
        serviceId: s.service.id,
        description: "Troca de lâmpada",
        fieldValues: {
          [s.asset.id]: " PAT-0042 ",
          [s.quantity.id]: "03",
          [s.date.id]: "2026-12-01",
          [s.shift.id]: "Tarde",
          [s.urgent.id]: "false",
          [s.notes.id]: "",
        },
      },
      prisma,
    );

    const stored = await prisma.requestFieldValue.findMany({
      where: { requestId: created.id },
      orderBy: { positionSnapshot: "asc" },
    });
    expect(stored.map(({ labelSnapshot, typeSnapshot, positionSnapshot, value }) => [labelSnapshot, typeSnapshot, positionSnapshot, value])).toEqual([
      ["Patrimônio", "SHORT_TEXT", 0, "PAT-0042"],
      ["Quantidade", "INTEGER", 1, "3"],
      ["Data desejada", "DATE", 2, "2026-12-01"],
      ["Turno", "SELECT", 3, "Tarde"],
      ["Urgente?", "YES_NO", 4, "false"],
    ]);
    const request = await prisma.request.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.every(({ createdAt }) => createdAt.getTime() === request.createdAt.getTime())).toBe(true);
  });

  it("keeps the answers when the field changes or is deactivated later (CA-FLD-08)", async () => {
    const s = await scenario();
    const created = await createRequest(
      {
        serviceId: s.service.id,
        description: "x",
        fieldValues: { [s.asset.id]: "PAT-1", [s.shift.id]: "Manhã", [s.urgent.id]: "true" },
      },
      prisma,
    );

    await prisma.serviceField.update({ where: { id: s.shift.id }, data: { label: "Período", options: ["Noite", "Madrugada"] } });
    await prisma.serviceField.update({ where: { id: s.asset.id }, data: { isActive: false } });

    await expect(
      prisma.requestFieldValue.findMany({ where: { requestId: created.id }, orderBy: { positionSnapshot: "asc" } }),
    ).resolves.toMatchObject([
      { labelSnapshot: "Patrimônio", value: "PAT-1" },
      { labelSnapshot: "Turno", value: "Manhã" },
      { labelSnapshot: "Urgente?", value: "true" },
    ]);
  });

  it("refuses invalid answers at the edges and writes nothing (CA-FLD-05, 06, 07)", async () => {
    const s = await scenario();
    const base = { [s.asset.id]: "PAT-1", [s.shift.id]: "Manhã", [s.urgent.id]: "true" };
    const cases: Array<[Record<string, string>, string, string]> = [
      [{ [s.asset.id]: "" }, s.asset.id, "required"],
      [{ [s.asset.id]: "a".repeat(201) }, s.asset.id, "too_long"],
      [{ [s.asset.id]: "linha\nquebrada" }, s.asset.id, "line_break"],
      [{ [s.notes.id]: "a".repeat(2001) }, s.notes.id, "too_long"],
      [{ [s.quantity.id]: "11" }, s.quantity.id, "out_of_range"],
      [{ [s.quantity.id]: "2,5" }, s.quantity.id, "not_integer"],
      [{ [s.date.id]: "2026-02-30" }, s.date.id, "invalid_date"],
      [{ [s.date.id]: "2101-01-01" }, s.date.id, "out_of_range"],
      [{ [s.shift.id]: "Noite" }, s.shift.id, "invalid_option"],
      [{ [s.urgent.id]: "talvez" }, s.urgent.id, "invalid_choice"],
    ];

    for (const [changes, fieldId, code] of cases) {
      const error = await createRequest(
        { serviceId: s.service.id, description: "x", fieldValues: { ...base, ...changes } },
        prisma,
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(FieldAnswersError);
      expect((error as FieldAnswersError).fieldErrors).toEqual([{ fieldId, code }]);
    }
    await expect(countRows(s.service.id)).resolves.toEqual({ requests: 0, values: 0, outbox: 0 });

    await expect(
      createRequest(
        { serviceId: s.service.id, description: "x", fieldValues: { ...base, [s.asset.id]: "a".repeat(200), [s.notes.id]: "a".repeat(2000) } },
        prisma,
      ),
    ).resolves.toBeTruthy();
  });

  it("refuses answers for inactive or other services' fields as an out-of-date form (CA-FLD-06)", async () => {
    const s = await scenario();
    const other = await scenario();
    const base = { [s.asset.id]: "PAT-1", [s.shift.id]: "Manhã", [s.urgent.id]: "true" };

    for (const fieldId of [s.inactive.id, other.asset.id]) {
      const error = await createRequest(
        { serviceId: s.service.id, description: "x", fieldValues: { ...base, [fieldId]: "y" } },
        prisma,
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(FieldAnswersError);
      expect((error as FieldAnswersError).reason).toBe("stale_form");
    }
    await expect(countRows(s.service.id)).resolves.toEqual({ requests: 0, values: 0, outbox: 0 });
  });

  it("opens a service without fields as before and refuses answers sent to it (CA-FLD-01)", async () => {
    const requester = await createDomainUser({ role: "REQUESTER" });
    authenticated.requireRequestCreator.mockResolvedValue(requester);
    const service = await createDomainService({
      categoryId: (await createDomainCategory()).id,
      sectorId: (await createDomainSector()).id,
    });

    const created = await createRequest({ serviceId: service.id, description: "Sem campos" }, prisma);

    await expect(prisma.requestFieldValue.count({ where: { requestId: created.id } })).resolves.toBe(0);
    await expect(
      createRequest(
        { serviceId: service.id, description: "x", fieldValues: { [crypto.randomUUID()]: "y" } },
        prisma,
      ),
    ).rejects.toBeInstanceOf(FieldAnswersError);
  });
});
