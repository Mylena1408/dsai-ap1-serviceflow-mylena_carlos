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

// SPEC 2026-11-02-auditoria-lgpd, 5.4 (SF-106; CA-AUD-06).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { GET } from "@/app/api/account/data/route";

function actAs(user: Pick<User, "id" | "name" | "email" | "role" | "sectorId" | "isActive"> | null) {
  session.getCurrentUser.mockResolvedValue(user && { ...user });
}

/** Carla opens a request in Diego's sector; Diego answers and writes a note; Bruno has his own request. */
async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const carla = await prisma.user.create({
    data: { name: "Carla Mendes", email: "carla@exemplo.test", role: "REQUESTER", passwordHash: "$argon2id$carla-hash" },
  });
  const bruno = await createDomainUser({ role: "REQUESTER" });
  const diego = await prisma.user.create({
    data: { name: "Diego Rocha", email: "diego@exemplo.test", role: "ATTENDANT", sectorId: sector.id, passwordHash: "$argon2id$diego-hash" },
  });

  const request = await createDomainRequest({ requesterId: carla.id, serviceId: service.id, sectorId: sector.id });
  await prisma.request.update({ where: { id: request.id }, data: { description: "A tomada da sala 12 não funciona." } });
  await prisma.requestStatusEvent.create({ data: { requestId: request.id, actorId: carla.id, toStatus: "OPEN" } });
  await prisma.requestComment.createMany({
    data: [
      { requestId: request.id, authorId: diego.id, body: "Vamos amanhã.", isInternal: false, createdAt: new Date(Date.now() - 60_000) },
      { requestId: request.id, authorId: diego.id, body: "Verificar o disjuntor antes.", isInternal: true },
    ],
  });
  const other = await createDomainRequest({ requesterId: bruno.id, serviceId: service.id, sectorId: sector.id });
  await prisma.request.update({ where: { id: other.id }, data: { description: "Pedido do Bruno" } });
  await prisma.notificationPreference.create({ data: { userId: carla.id, category: "STATUS", emailEnabled: true, updatedAt: new Date() } });

  return { carla, diego, request };
}

describe("\"Meus dados\" over the database (SF-106; CA-AUD-06)", () => {
  it("gives the requester her own data as a JSON download, without hashes or internal notes", async () => {
    const { carla } = await scenario();
    actAs(carla);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="serviceflow-meus-dados-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");

    const text = await response.text();
    const file = JSON.parse(text);
    expect(file.pessoa).toMatchObject({ nome: "Carla Mendes", email: "carla@exemplo.test", perfil: "Solicitante" });
    expect(file.emailsQueVoceEscolheuReceber).toEqual(["Mudanças de status"]);
    expect(file.solicitacoesQueVoceAbriu).toHaveLength(1);
    expect(file.solicitacoesQueVoceAbriu[0]).toMatchObject({
      descricao: "A tomada da sala 12 não funciona.",
      historico: [{ status: "Aberta", por: "Carla Mendes" }],
      comentarios: [{ autor: "Diego Rocha", texto: "Vamos amanhã." }],
    });
    for (const absent of ["argon2id", "Verificar o disjuntor", "Pedido do Bruno", "diego@exemplo.test"]) {
      expect(text).not.toContain(absent);
    }
  });

  it("gives the attendant the comments and notes he wrote, and records each download", async () => {
    const { diego } = await scenario();
    actAs(diego);

    const file = JSON.parse(await (await GET()).text());
    await GET();

    expect(file.pessoa).toMatchObject({ nome: "Diego Rocha", perfil: "Atendente" });
    expect(file.solicitacoesQueVoceAbriu).toEqual([]);
    expect(file.comentariosQueVoceEscreveuEmOutrasSolicitacoes).toEqual([
      expect.objectContaining({ texto: "Vamos amanhã.", notaInterna: false }),
      expect.objectContaining({ texto: "Verificar o disjuntor antes.", notaInterna: true }),
    ]);
    await expect(prisma.auditEntry.findMany({ where: { action: "EXPORTED" } })).resolves.toEqual([
      expect.objectContaining({ actorId: diego.id, actorRole: "ATTENDANT", entityType: "USER", entityId: diego.id, changes: [] }),
      expect.objectContaining({ actorId: diego.id }),
    ]);
  });

  it("refuses without a session and records nothing", async () => {
    await scenario();
    actAs(null);

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe("Entre no ServiceFlow para baixar seus dados.");
    await expect(prisma.auditEntry.count()).resolves.toBe(0);
  });
});
