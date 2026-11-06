import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import {
  createCannedResponse,
  listResponsesForRequest,
  listSectorResponses,
  setCannedResponseActive,
  updateCannedResponse,
} from "@/modules/canned-responses";
import { ConflictError, NotFoundError } from "@/server/errors";

// SPEC 2026-11-06-respostas-prontas over the database (SF-152; CA-RSP-01 to 03).

type Actor = { id: string; name: string; email: string; role: Role; sectorId: string | null };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, isActive: true });

async function scenario() {
  const sector = await createDomainSector();
  const otherSector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const rita = await prisma.user.create({
    data: { name: "Rita de Cássia", email: `rita-${crypto.randomUUID()}@example.test`, role: "REQUESTER", passwordHash: "$argon2id$integration-placeholder" },
  });
  const diego = await prisma.user.create({
    data: { name: "Diego Rocha", email: `diego-${crypto.randomUUID()}@example.test`, role: "ATTENDANT", sectorId: sector.id, passwordHash: "$argon2id$integration-placeholder" },
  });
  const caio = await createDomainUser({ role: "ATTENDANT", sectorId: otherSector.id });
  const request = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: sector.id });
  return { rita, diego, caio, request, service };
}

describe("canned responses schema (CA-RSP-02)", () => {
  it("refuses titles and bodies out of limits and a second active title in the sector, ignoring case", async () => {
    const { diego } = await scenario();
    const row = (data: Record<string, unknown>) =>
      prisma.cannedResponse.create({
        data: { sectorId: diego.sectorId!, title: "Senha", body: "Passos", createdById: diego.id, updatedById: diego.id, createdAt: new Date(), updatedAt: new Date(), ...data },
      });
    await expect(row({ title: "" })).rejects.toThrow();
    await expect(row({ title: " Senha" })).rejects.toThrow();
    await expect(row({ title: "x".repeat(121) })).rejects.toThrow();
    await expect(row({ body: "" })).rejects.toThrow();
    await expect(row({ body: "x".repeat(5001) })).rejects.toThrow();
    await row({});
    await expect(row({ title: "SENHA" })).rejects.toThrow();
    // An inactive response does not block the title.
    await row({ title: "senha", isActive: false });
  });
});

describe("canned responses use cases (CA-RSP-01 to 03)", () => {
  it("creates, edits, deactivates and reactivates within the sector; another sector never sees them", async () => {
    const { diego, caio } = await scenario();
    actAs(diego);
    const created = await createCannedResponse({ title: "Visita técnica", body: "Olá, {{solicitante}}. O técnico passa amanhã." }, prisma);
    await expect(createCannedResponse({ title: "VISITA TÉCNICA", body: "Outro" }, prisma)).rejects.toThrow(ConflictError);
    await updateCannedResponse(created.id, { title: "Visita técnica", body: "Olá, {{solicitante}}. Passamos às 9 h ({{codigo}})." }, prisma);
    await setCannedResponseActive(created.id, false, prisma);
    // While inactive, the title is free; reactivating the first then conflicts.
    await createCannedResponse({ title: "Visita técnica", body: "Nova versão" }, prisma);
    await expect(setCannedResponseActive(created.id, true, prisma)).rejects.toThrow(ConflictError);

    const listed = await listSectorResponses(prisma);
    expect(listed.map(({ title, isActive }) => [title, isActive])).toEqual([
      ["Visita técnica", true],
      ["Visita técnica", false],
    ]);
    expect(listed[1]).toMatchObject({ createdByName: "Diego Rocha", updatedByName: "Diego Rocha" });

    actAs(caio);
    expect(await listSectorResponses(prisma)).toEqual([]);
    await expect(updateCannedResponse(created.id, { title: "x", body: "y" }, prisma)).rejects.toThrow(NotFoundError);
  });

  it("renders the active responses for a request with the requester's first name, the code and the attendant", async () => {
    const { diego, caio, request } = await scenario();
    actAs(diego);
    await createCannedResponse({ title: "Saudação", body: "Olá, {{solicitante}}! Aqui é {{atendente}}, sobre {{codigo}}." }, prisma);
    const rendered = await listResponsesForRequest(request.id, prisma);
    expect(rendered).toEqual([
      expect.objectContaining({ title: "Saudação", text: `Olá, Rita! Aqui é Diego Rocha, sobre ${request.id.slice(0, 8).toUpperCase()}.` }),
    ]);

    actAs(caio);
    await expect(listResponsesForRequest(request.id, prisma)).rejects.toThrow(NotFoundError);
  });
});
