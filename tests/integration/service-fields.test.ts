import { describe, expect, it, vi } from "vitest";
import type { Role, User } from "@prisma/client";
import { prisma } from "./fixtures";
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/server/errors";
import {
  createDomainCategory,
  createDomainRequest,
  createDomainSector,
  createDomainService,
  createDomainUser,
} from "./domain-fixtures";

// SPEC 2026-11-01-campos-personalizados, section 5.1 (SF-072; CA-FLD-02 and 03).

const session = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import {
  createServiceField,
  deactivateServiceField,
  listServiceFields,
  moveServiceField,
  reactivateServiceField,
  updateServiceField,
} from "@/modules/service-fields";

function setSessionActor(user: Pick<User, "id" | "name" | "email" | "role" | "sectorId" | "isActive"> | null) {
  session.getCurrentUser.mockResolvedValue(
    user && {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      sectorId: user.sectorId,
      isActive: user.isActive,
    },
  );
}

async function actAs(role: Role) {
  const sector = role === "ATTENDANT" ? await createDomainSector() : null;
  const user = await createDomainUser({ role, sectorId: sector?.id });
  setSessionActor(user);
  return user;
}

async function createServiceContext() {
  const category = await createDomainCategory();
  const sector = await createDomainSector();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  return { category, sector, service };
}

function fieldInput(label: string, overrides: Record<string, unknown> = {}) {
  return {
    label,
    helpText: null,
    type: "SHORT_TEXT",
    isRequired: true,
    options: [],
    minValue: null,
    maxValue: null,
    ...overrides,
  };
}

async function activeOrder(serviceId: string): Promise<string[]> {
  const fields = await prisma.serviceField.findMany({
    where: { serviceId, isActive: true },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { label: true },
  });
  return fields.map((field) => field.label);
}

describe("custom field configuration (SF-072)", () => {
  it("lets an administrator create fields of every type in order (CA-FLD-02)", async () => {
    await actAs("ADMIN");
    const { service } = await createServiceContext();

    const created = [
      await createServiceField(service.id, fieldInput("  Patrimônio  ", { helpText: " Etiqueta " }), prisma),
      await createServiceField(service.id, fieldInput("Descrição do local", { type: "LONG_TEXT", isRequired: false }), prisma),
      await createServiceField(service.id, fieldInput("Quantidade", { type: "INTEGER", minValue: 1, maxValue: 50 }), prisma),
      await createServiceField(service.id, fieldInput("Data desejada", { type: "DATE" }), prisma),
      await createServiceField(service.id, fieldInput("Turno", { type: "SELECT", options: ["Manhã", "Tarde"] }), prisma),
      await createServiceField(service.id, fieldInput("Urgente?", { type: "YES_NO" }), prisma),
    ];

    expect(created[0]).toMatchObject({
      serviceId: service.id,
      label: "Patrimônio",
      helpText: "Etiqueta",
      options: [],
      position: 0,
      isActive: true,
    });
    expect(created.map((field) => field.position)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(created[2]).toMatchObject({ minValue: 1, maxValue: 50 });
    expect(created[4]).toMatchObject({ options: ["Manhã", "Tarde"] });
    await expect(listServiceFields(prisma)).resolves.toHaveLength(6);
  });

  it("edits a field, keeps its type and refuses a repeated label among the active ones (CA-FLD-03)", async () => {
    await actAs("ADMIN");
    const { service } = await createServiceContext();
    const turno = await createServiceField(
      service.id,
      fieldInput("Turno", { type: "SELECT", options: ["Manhã", "Tarde"] }),
      prisma,
    );
    await createServiceField(service.id, fieldInput("Sala"), prisma);

    await expect(
      updateServiceField(
        turno.id,
        fieldInput("Turno preferido", { type: "SELECT", options: ["Manhã", "Tarde", "Noite"], isRequired: false }),
        prisma,
      ),
    ).resolves.toMatchObject({ label: "Turno preferido", options: ["Manhã", "Tarde", "Noite"], isRequired: false });
    await expect(updateServiceField(turno.id, fieldInput("Turno preferido"), prisma)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(
      updateServiceField(turno.id, fieldInput("SALA", { type: "SELECT", options: ["A", "B"] }), prisma),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(createServiceField(service.id, fieldInput("sala"), prisma)).rejects.toBeInstanceOf(ConflictError);
    await expect(prisma.serviceField.findUniqueOrThrow({ where: { id: turno.id } })).resolves.toMatchObject({
      type: "SELECT",
      label: "Turno preferido",
    });
  });

  it("refuses the eleventh active field and invalid configurations (CA-FLD-03)", async () => {
    await actAs("ADMIN");
    const { service } = await createServiceContext();
    for (let index = 1; index <= 10; index += 1) {
      await createServiceField(service.id, fieldInput(`Campo ${index}`), prisma);
    }

    await expect(createServiceField(service.id, fieldInput("Campo 11"), prisma)).rejects.toBeInstanceOf(ConflictError);

    const other = await createServiceContext();
    for (const input of [
      fieldInput(""),
      fieldInput("a".repeat(81)),
      fieldInput("Turno", { type: "SELECT", options: ["Só uma"] }),
      fieldInput("Turno", { type: "SELECT", options: ["Manhã", "manhã"] }),
      fieldInput("Qtd", { type: "INTEGER", minValue: 9, maxValue: 1 }),
      fieldInput("Data", { type: "DATE", minValue: 1 }),
      fieldInput("Texto", { options: ["A", "B"] }),
      fieldInput("Vários", { type: "MULTI_SELECT" }),
    ]) {
      await expect(createServiceField(other.service.id, input, prisma)).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(prisma.serviceField.count({ where: { serviceId: service.id } })).resolves.toBe(10);
    await expect(prisma.serviceField.count({ where: { serviceId: other.service.id } })).resolves.toBe(0);
    await expect(createServiceField(crypto.randomUUID(), fieldInput("X"), prisma)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("reorders, deactivates and reactivates at the end of the form (CA-FLD-02)", async () => {
    await actAs("ADMIN");
    const { service } = await createServiceContext();
    const [first, , third] = [
      await createServiceField(service.id, fieldInput("A"), prisma),
      await createServiceField(service.id, fieldInput("B"), prisma),
      await createServiceField(service.id, fieldInput("C"), prisma),
    ];

    await moveServiceField(third.id, "up", prisma);
    expect(await activeOrder(service.id)).toEqual(["A", "C", "B"]);

    await deactivateServiceField(first.id, prisma);
    expect(await activeOrder(service.id)).toEqual(["C", "B"]);
    await expect(updateServiceField(first.id, fieldInput("A2"), prisma)).rejects.toBeInstanceOf(ConflictError);

    await reactivateServiceField(first.id, prisma);
    expect(await activeOrder(service.id)).toEqual(["C", "B", "A"]);
  });

  it("refuses a reactivation over the limit or with a label taken in the meantime", async () => {
    await actAs("ADMIN");
    const { service } = await createServiceContext();
    const old = await createServiceField(service.id, fieldInput("Patrimônio"), prisma);
    await deactivateServiceField(old.id, prisma);
    await createServiceField(service.id, fieldInput("PATRIMÔNIO"), prisma);

    await expect(reactivateServiceField(old.id, prisma)).rejects.toBeInstanceOf(ConflictError);

    const full = await createServiceContext();
    const spare = await createServiceField(full.service.id, fieldInput("Reserva"), prisma);
    await deactivateServiceField(spare.id, prisma);
    for (let index = 1; index <= 10; index += 1) {
      await createServiceField(full.service.id, fieldInput(`Campo ${index}`), prisma);
    }
    await expect(reactivateServiceField(spare.id, prisma)).rejects.toBeInstanceOf(ConflictError);
  });

  it("keeps answered fields: deactivation works and the answer stays untouched", async () => {
    await actAs("ADMIN");
    const { service, sector } = await createServiceContext();
    const field = await createServiceField(service.id, fieldInput("Patrimônio"), prisma);
    const requester = await createDomainUser({ role: "REQUESTER" });
    const request = await createDomainRequest({ requesterId: requester.id, serviceId: service.id, sectorId: sector.id });
    await prisma.requestFieldValue.create({
      data: {
        requestId: request.id,
        fieldId: field.id,
        labelSnapshot: "Patrimônio",
        typeSnapshot: "SHORT_TEXT",
        positionSnapshot: 0,
        value: "1234",
      },
    });

    await updateServiceField(field.id, fieldInput("Número do patrimônio"), prisma);
    await deactivateServiceField(field.id, prisma);

    await expect(prisma.requestFieldValue.findFirstOrThrow({ where: { requestId: request.id } })).resolves.toMatchObject({
      labelSnapshot: "Patrimônio",
      value: "1234",
    });
  });

  it("denies every operation to requesters, attendants and anonymous users (CA-FLD-02)", async () => {
    await actAs("ADMIN");
    const { service } = await createServiceContext();
    const field = await createServiceField(service.id, fieldInput("A"), prisma);

    for (const role of ["REQUESTER", "ATTENDANT"] as const) {
      await actAs(role);
      await expect(listServiceFields(prisma)).rejects.toBeInstanceOf(AuthorizationError);
      await expect(createServiceField(service.id, fieldInput("B"), prisma)).rejects.toBeInstanceOf(AuthorizationError);
      await expect(updateServiceField(field.id, fieldInput("B"), prisma)).rejects.toBeInstanceOf(AuthorizationError);
      await expect(moveServiceField(field.id, "down", prisma)).rejects.toBeInstanceOf(AuthorizationError);
      await expect(deactivateServiceField(field.id, prisma)).rejects.toBeInstanceOf(AuthorizationError);
      await expect(reactivateServiceField(field.id, prisma)).rejects.toBeInstanceOf(AuthorizationError);
    }

    setSessionActor(null);
    await expect(createServiceField(service.id, fieldInput("B"), prisma)).rejects.toBeInstanceOf(AuthenticationError);
    await expect(prisma.serviceField.findMany({ where: { serviceId: service.id } })).resolves.toMatchObject([
      { label: "A", isActive: true },
    ]);
  });
});
