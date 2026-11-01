import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { AuthenticationError, NotFoundError } from "@/server/errors";
import { createDomainCategory, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-01-campos-personalizados, sections 5.4 and 5.5 (SF-074; CA-FLD-09).

const session = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { createRequest, listRequestFieldAnswers } from "@/modules/requests";
import { DEMO_SERVICE_FIELDS, seedDemoData } from "../../scripts/demo-data";

type Actor = { id: string; role: Role; sectorId: string | null; isActive: boolean };

function actAs(actor: Actor | null) {
  session.getCurrentUser.mockResolvedValue(
    actor && { ...actor, name: "Integration user", email: `${actor.id}@example.test` },
  );
}

async function scenario() {
  const category = await createDomainCategory();
  const sector = await createDomainSector();
  const otherSector = await createDomainSector();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const owner = await createDomainUser({ role: "REQUESTER" });
  const otherRequester = await createDomainUser({ role: "REQUESTER" });
  const attendant = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const otherAttendant = await createDomainUser({ role: "ATTENDANT", sectorId: otherSector.id });
  const admin = await createDomainUser({ role: "ADMIN" });
  const field = (label: string, type: "SHORT_TEXT" | "DATE" | "YES_NO" | "LONG_TEXT", position: number) =>
    prisma.serviceField.create({
      data: { serviceId: service.id, label, type, isRequired: false, options: [], position },
    });
  const fields = {
    notes: await field("Observações", "LONG_TEXT", 3),
    asset: await field("Patrimônio", "SHORT_TEXT", 0),
    date: await field("Data desejada", "DATE", 1),
    urgent: await field("Urgente?", "YES_NO", 2),
  };

  actAs(owner);
  const request = await createRequest(
    {
      serviceId: service.id,
      description: "Pedido com campos",
      fieldValues: {
        [fields.asset.id]: "PAT-0042",
        [fields.date.id]: "2026-12-01",
        [fields.urgent.id]: "true",
        [fields.notes.id]: "Linha 1\nLinha 2",
      },
    },
    prisma,
  );

  return { service, owner, otherRequester, attendant, otherAttendant, admin, fields, request };
}

describe("custom field answers in the request details (SF-074)", () => {
  it("shows the answers to the requester and to attendants of the sector, in snapshot order (CA-FLD-09)", async () => {
    const s = await scenario();

    for (const actor of [s.owner, s.attendant]) {
      actAs(actor);
      const answers = await listRequestFieldAnswers(s.request.id, prisma);
      expect(answers.map(({ label, type, position, value }) => ({ label, type, position, value }))).toEqual([
        { label: "Patrimônio", type: "SHORT_TEXT", position: 0, value: "PAT-0042" },
        { label: "Data desejada", type: "DATE", position: 1, value: "2026-12-01" },
        { label: "Urgente?", type: "YES_NO", position: 2, value: "true" },
        { label: "Observações", type: "LONG_TEXT", position: 3, value: "Linha 1\nLinha 2" },
      ]);
    }
  });

  it("keeps the labels of the opening after the field is renamed or deactivated", async () => {
    const s = await scenario();
    await prisma.serviceField.update({ where: { id: s.fields.asset.id }, data: { label: "Número do bem", isActive: false } });

    actAs(s.owner);
    const answers = await listRequestFieldAnswers(s.request.id, prisma);

    expect(answers[0]).toMatchObject({ label: "Patrimônio", value: "PAT-0042" });
  });

  it("hides the answers from other requesters, other sectors and administrators (CA-FLD-09)", async () => {
    const s = await scenario();

    for (const actor of [s.otherRequester, s.otherAttendant, s.admin]) {
      actAs(actor);
      await expect(listRequestFieldAnswers(s.request.id, prisma)).rejects.toBeInstanceOf(NotFoundError);
    }
    actAs({ ...s.attendant, isActive: false });
    await expect(listRequestFieldAnswers(s.request.id, prisma)).rejects.toThrow();
    actAs(null);
    await expect(listRequestFieldAnswers(s.request.id, prisma)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("returns no answers for a request without fields and refuses unknown requests", async () => {
    const s = await scenario();
    actAs(s.owner);
    const plain = await createRequest(
      {
        serviceId: (
          await createDomainService({
            categoryId: (await createDomainCategory()).id,
            sectorId: (await createDomainSector()).id,
          })
        ).id,
        description: "Sem campos",
      },
      prisma,
    );

    await expect(listRequestFieldAnswers(plain.id, prisma)).resolves.toEqual([]);
    await expect(listRequestFieldAnswers(crypto.randomUUID(), prisma)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("demonstration service with custom fields (SF-074)", () => {
  it("configures the example fields once, in order, without touching other services", async () => {
    const now = new Date("2026-10-30T12:00:00.000Z");
    await seedDemoData(prisma, now);
    await seedDemoData(prisma, now);

    for (const { service: name, fields } of DEMO_SERVICE_FIELDS) {
      const service = await prisma.service.findFirstOrThrow({ where: { name } });
      const stored = await prisma.serviceField.findMany({ where: { serviceId: service.id }, orderBy: { position: "asc" } });
      expect(stored.map(({ label, type, isRequired, position }) => ({ label, type, isRequired, position }))).toEqual(
        fields.map(({ label, type, isRequired }, position) => ({ label, type, isRequired, position })),
      );
    }
    await expect(prisma.serviceField.count()).resolves.toBe(
      DEMO_SERVICE_FIELDS.reduce((total, { fields }) => total + fields.length, 0),
    );
  });
});
