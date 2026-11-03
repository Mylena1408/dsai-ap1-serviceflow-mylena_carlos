import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-03-campos-condicionais-atendimento, 5.4 to 5.8 over the database (SF-136; CA-CND-06 to 09).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import {
  AttendanceFieldsMissingError,
  assumeRequest,
  createRequest,
  getAttendanceFields,
  getAttendantRequest,
  listRequestFieldAnswers,
  saveAttendanceFields,
  transitionRequestStatus,
} from "@/modules/requests";
import { createServiceField, FieldAnswersError } from "@/modules/service-fields";
import { anonymizeUser } from "@/modules/users";
import { createMemoryDocumentStorage } from "@/server/storage";
import { ConflictError, NotFoundError } from "@/server/errors";
import { GET as downloadPersonalData } from "@/app/api/account/data/route";

function actAs(user: User) {
  session.getCurrentUser.mockResolvedValue({ id: user.id, name: user.name, email: user.email, role: user.role, sectorId: user.sectorId, isActive: user.isActive });
}

const base = { helpText: null, isRequired: true, options: [] as string[], minValue: null, maxValue: null };

async function scenario() {
  const sector = await createDomainSector();
  const otherSector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const admin = await createDomainUser({ role: "ADMIN" });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const bia = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const caio = await createDomainUser({ role: "ATTENDANT", sectorId: otherSector.id });
  actAs(admin);
  const asset = await createServiceField(service.id, { ...base, label: "Patrimônio", type: "SHORT_TEXT" }, prisma);
  const attendance = { ...base, audience: "ATTENDANT" as const };
  const order = await createServiceField(service.id, { ...attendance, label: "Ordem de serviço", type: "SHORT_TEXT" }, prisma);
  const replaced = await createServiceField(service.id, { ...attendance, label: "Peça trocada", type: "YES_NO" }, prisma);
  const part = await createServiceField(
    service.id,
    { ...attendance, label: "Qual peça", type: "SHORT_TEXT", conditionFieldId: replaced.id, conditionValue: "true" },
    prisma,
  );
  const notes = await createServiceField(service.id, { ...attendance, label: "Observação técnica", type: "LONG_TEXT", isRequired: false }, prisma);

  actAs(rita);
  const request = await createRequest({ serviceId: service.id, description: "Cadeira quebrada", fieldValues: { [asset.id]: "4521" } }, prisma);
  actAs(ana);
  await assumeRequest({ requestId: request.id }, prisma);
  await transitionRequestStatus({ requestId: request.id, toStatus: "IN_PROGRESS" }, prisma);
  return { admin, rita, ana, bia, caio, request, order, replaced, part, notes, asset };
}

describe("attendance fields over the database (SF-136)", () => {
  it("saves, changes and records labels only; demands the required ones at completion (CA-CND-06 and 07)", async () => {
    const { ana, request, order, replaced, part, notes } = await scenario();
    const save = (values: Record<string, string>) => saveAttendanceFields({ requestId: request.id, values }, prisma);

    await expect(getAttendanceFields(request.id, prisma)).resolves.toMatchObject({ values: {} });
    await expect(transitionRequestStatus({ requestId: request.id, toStatus: "COMPLETED" }, prisma)).rejects.toThrow(AttendanceFieldsMissingError);

    // A required field may stay blank while saving; the hidden "Qual peça" is discarded.
    await expect(save({ [order.id]: "OS-2026-17", [replaced.id]: "false", [part.id]: "Rodízio", [notes.id]: "" })).resolves.toEqual({
      changed: ["Ordem de serviço", "Peça trocada"],
    });
    // Same values: nothing changes and nothing is recorded.
    await expect(save({ [order.id]: "OS-2026-17", [replaced.id]: "false", [part.id]: "", [notes.id]: "" })).resolves.toEqual({ changed: [] });

    // "Peça trocada = Sim" makes "Qual peça" required for the completion.
    await save({ [order.id]: "OS-2026-17", [replaced.id]: "true", [notes.id]: "Trocar o rodízio" });
    try {
      await transitionRequestStatus({ requestId: request.id, toStatus: "COMPLETED" }, prisma);
      throw new Error("completed");
    } catch (error) {
      expect(error).toBeInstanceOf(AttendanceFieldsMissingError);
      expect((error as AttendanceFieldsMissingError).labels).toEqual(["Qual peça"]);
    }

    await save({ [order.id]: "OS-2026-17", [replaced.id]: "true", [part.id]: "Rodízio", [notes.id]: "" });
    await expect(getAttendanceFields(request.id, prisma)).resolves.toMatchObject({
      values: { [order.id]: "OS-2026-17", [replaced.id]: "true", [part.id]: "Rodízio" },
    });

    const history = await getAttendantRequest(request.id, prisma);
    expect(history.fieldUpdates?.map(({ labels, actor }) => [labels, actor.id])).toEqual([
      [["Ordem de serviço", "Peça trocada"], ana.id],
      [["Peça trocada", "Observação técnica"], ana.id],
      [["Qual peça", "Observação técnica"], ana.id],
    ]);
    await expect(prisma.requestFieldValue.findFirstOrThrow({ where: { requestId: request.id, fieldId: order.id } })).resolves.toMatchObject({
      updatedById: ana.id,
    });

    await expect(transitionRequestStatus({ requestId: request.id, toStatus: "COMPLETED" }, prisma)).resolves.toMatchObject({ status: "COMPLETED" });
    // Completed: nothing more is saved.
    await expect(save({ [order.id]: "OS-2" })).rejects.toThrow(ConflictError);
  });

  it("refuses others, invalid values and requester fields (CA-CND-06)", async () => {
    const { bia, caio, rita, request, order, replaced, asset } = await scenario();
    const save = (values: Record<string, string>) => saveAttendanceFields({ requestId: request.id, values }, prisma);

    await expect(save({ [replaced.id]: "talvez" })).rejects.toThrow(FieldAnswersError);
    await expect(save({ [asset.id]: "9999" })).rejects.toMatchObject({ reason: "stale_form" });
    actAs(bia);
    await expect(save({ [order.id]: "OS-1" })).rejects.toThrow(ConflictError);
    actAs(caio);
    await expect(save({ [order.id]: "OS-1" })).rejects.toThrow(NotFoundError);
    actAs(rita);
    await expect(save({ [order.id]: "OS-1" })).rejects.toThrow(NotFoundError);
    await expect(prisma.requestFieldValue.count({ where: { requestId: request.id, updatedById: { not: null } } })).resolves.toBe(0);
    await expect(prisma.requestFieldUpdateEvent.count({ where: { requestId: request.id } })).resolves.toBe(0);
  });

  it("shows the attendance's answers only to the team, out of the requester's data, and anonymizes their text (CA-CND-08 and 09)", async () => {
    const { admin, rita, ana, request, order, replaced, notes } = await scenario();
    await saveAttendanceFields({ requestId: request.id, values: { [order.id]: "OS-9", [replaced.id]: "false", [notes.id]: "Cliente estava ausente" } }, prisma);

    const team = await listRequestFieldAnswers(request.id, prisma);
    expect(team.map(({ label, audience }) => [label, audience])).toEqual([
      ["Patrimônio", "REQUESTER"],
      ["Ordem de serviço", "ATTENDANT"],
      ["Peça trocada", "ATTENDANT"],
      ["Observação técnica", "ATTENDANT"],
    ]);

    actAs(rita);
    expect((await listRequestFieldAnswers(request.id, prisma)).map(({ label }) => label)).toEqual(["Patrimônio"]);
    const own = await (await import("@/modules/requests")).getRequesterRequest(request.id, prisma);
    expect(own.fieldUpdates).toBeUndefined();
    const file = JSON.parse(await (await downloadPersonalData()).text());
    expect(file.solicitacoesQueVoceAbriu[0].respostas).toEqual([{ campo: "Patrimônio", valor: "4521" }]);

    actAs(ana);
    await transitionRequestStatus({ requestId: request.id, toStatus: "COMPLETED" }, prisma);
    await prisma.user.update({ where: { id: ana.id }, data: { isActive: false } });
    actAs(admin);
    await anonymizeUser({ userId: ana.id, confirmed: true }, prisma, createMemoryDocumentStorage());
    await expect(
      prisma.requestFieldValue.findMany({ where: { requestId: request.id }, orderBy: { positionSnapshot: "asc" }, select: { value: true } }),
    ).resolves.toEqual([
      { value: "4521" },
      { value: "[conteúdo removido na anonimização]" },
      // "Sim ou não" holds no free text and stays (5.8.2).
      { value: "false" },
      { value: "[conteúdo removido na anonimização]" },
    ]);
  });
});
