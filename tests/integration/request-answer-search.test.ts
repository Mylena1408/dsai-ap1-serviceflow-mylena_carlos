import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./fixtures";
import {
  createDomainCategory,
  createDomainRequest,
  createDomainSector,
  createDomainService,
  createDomainUser,
} from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { searchAttendantQueue, searchRequesterRequests } from "@/modules/requests";

// SPEC 2026-11-06-aprofundamento-configurabilidade, 3.3.5 (SF-163; CA-CMP-05): the search also
// looks at the field answers, within the scope each list already has.

function actAs(user: User) {
  session.getCurrentUser.mockResolvedValue({ id: user.id, name: user.name, email: user.email, role: user.role, sectorId: user.sectorId, isActive: user.isActive });
}

async function scenario() {
  const sector = await createDomainSector();
  const otherSector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const otherService = await createDomainService({ categoryId: category.id, sectorId: otherSector.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const paulo = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const field = (label: string, type: string, position: number, serviceId = service.id) =>
    prisma.serviceField.create({ data: { serviceId, label, type: type as never, isRequired: false, options: [], position } });
  const cpf = await field("CPF", "CPF", 0);
  const phone = await field("Telefone", "PHONE", 1);
  const asset = await field("Patrimônio", "SHORT_TEXT", 2);
  const order = await prisma.serviceField.create({
    data: { serviceId: service.id, label: "Ordem de serviço", type: "SHORT_TEXT", isRequired: false, options: [], position: 3, audience: "ATTENDANT" },
  });
  const foreignCpf = await field("CPF", "CPF", 0, otherService.id);

  async function request(description: string, requesterId: string, answers: Array<{ fieldId: string; type: string; value: string; byTeam?: boolean }>, inOtherSector = false) {
    const created = await createDomainRequest({
      requesterId,
      serviceId: inOtherSector ? otherService.id : service.id,
      sectorId: inOtherSector ? otherSector.id : sector.id,
    });
    await prisma.request.update({ where: { id: created.id }, data: { description } });
    for (const [position, answer] of answers.entries()) {
      await prisma.requestFieldValue.create({
        data: {
          requestId: created.id,
          fieldId: answer.fieldId,
          labelSnapshot: "Resposta",
          typeSnapshot: answer.type as never,
          positionSnapshot: position,
          value: answer.value,
          ...(answer.byTeam ? { updatedById: ana.id, updatedAt: new Date() } : {}),
        },
      });
    }
    return created;
  }

  await request("Reembolso de táxi", rita.id, [
    { fieldId: cpf.id, type: "CPF", value: "52998224725" },
    { fieldId: phone.id, type: "PHONE", value: "91987654321" },
    { fieldId: asset.id, type: "SHORT_TEXT", value: "Etiqueta 50%-A" },
    { fieldId: order.id, type: "SHORT_TEXT", value: "OS-7781", byTeam: true },
  ]);
  await request("Troca de monitor", rita.id, [{ fieldId: asset.id, type: "SHORT_TEXT", value: "PAT-1203" }]);
  await request("Pedido do Paulo", paulo.id, [{ fieldId: cpf.id, type: "CPF", value: "52998224725" }]);
  await request("Em outro setor", rita.id, [{ fieldId: foreignCpf.id, type: "CPF", value: "52998224725" }], true);

  return { rita, paulo, ana };
}

const descriptions = (result: { items: Array<{ description: string }> }) => result.items.map(({ description }) => description).sort();

describe("search by field answers (SF-163)", () => {
  it("finds the requester's own requests by the answers the requester gave", async () => {
    const { rita } = await scenario();
    actAs(rita);

    expect(descriptions(await searchRequesterRequests({ q: "pat-1203" }, prisma))).toEqual(["Troca de monitor"]);
    // Formatted search terms reach the digits stored for CPF and phone.
    expect(descriptions(await searchRequesterRequests({ q: "529.982.247" }, prisma))).toEqual(["Em outro setor", "Reembolso de táxi"]);
    expect(descriptions(await searchRequesterRequests({ q: "(91) 98765" }, prisma))).toEqual(["Reembolso de táxi"]);
    // The LIKE wildcards in the term stay plain text.
    expect(descriptions(await searchRequesterRequests({ q: "50%-A" }, prisma))).toEqual(["Reembolso de táxi"]);
    expect(descriptions(await searchRequesterRequests({ q: "50%-B" }, prisma))).toEqual([]);
  });

  it("does not let the requester find a request by an answer of the attendance", async () => {
    const { rita, ana } = await scenario();
    actAs(rita);
    expect(descriptions(await searchRequesterRequests({ q: "OS-7781" }, prisma))).toEqual([]);

    actAs(ana);
    expect(descriptions(await searchAttendantQueue({ q: "OS-7781" }, prisma))).toEqual(["Reembolso de táxi"]);
  });

  it("keeps each list's scope: another requester's request and another sector are never found", async () => {
    const { rita, paulo, ana } = await scenario();

    actAs(paulo);
    expect(descriptions(await searchRequesterRequests({ q: "52998224725" }, prisma))).toEqual(["Pedido do Paulo"]);

    actAs(rita);
    expect(descriptions(await searchRequesterRequests({ q: "52998224725" }, prisma))).toEqual(["Em outro setor", "Reembolso de táxi"]);

    actAs(ana);
    expect(descriptions(await searchAttendantQueue({ q: "529.982.247-25" }, prisma))).toEqual(["Pedido do Paulo", "Reembolso de táxi"]);
  });

  it("still finds by description and service name, and nothing for a term that matches no answer", async () => {
    const { rita } = await scenario();
    actAs(rita);
    expect(descriptions(await searchRequesterRequests({ q: "táxi" }, prisma))).toEqual(["Reembolso de táxi"]);
    expect(descriptions(await searchRequesterRequests({ q: "00000" }, prisma))).toEqual([]);
  });
});
