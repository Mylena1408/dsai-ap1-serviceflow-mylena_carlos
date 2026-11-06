import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { cannedResponseInputSchema, firstName, renderCannedResponse } from "@/modules/canned-responses/domain/canned-response";
import type { CannedResponseRecord, CannedResponseRepository } from "@/modules/canned-responses/application/canned-responses";
import { appendToComment } from "@/shared/comments";

const authorization = vi.hoisted(() => ({ requireCurrentActor: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import {
  createCannedResponse,
  listActiveResponses,
  listResponsesForRequest,
  listSectorResponses,
  setCannedResponseActive,
  updateCannedResponse,
} from "@/modules/canned-responses/application/canned-responses";
import { CannedResponsePicker } from "@/app/_components/canned-response-picker";

// SPEC 2026-11-06-respostas-prontas, 4 (SF-152 and SF-153; CA-RSP-01 to 04).

const values = { requesterName: "Ana Paula Souza", serviceName: "Reparo elétrico", shortCode: "AB12CD34", attendantName: "Diego Rocha" };

describe("fields and text (4.2 to 4.4)", () => {
  it("replaces the four fields, tolerating spaces and case, and keeps unknown ones", () => {
    expect(
      renderCannedResponse("Olá, {{solicitante}}! Sobre {{ servico }} ({{CODIGO}}): {{atendente}} cuida. {{prazo}}", values),
    ).toBe("Olá, Ana! Sobre Reparo elétrico (AB12CD34): Diego Rocha cuida. {{prazo}}");
    expect(firstName("  Bruno  Lima ")).toBe("Bruno");
  });

  it("appends after what is written, with a blank line", () => {
    expect(appendToComment("", "Texto")).toBe("Texto");
    expect(appendToComment("Oi.  \n", "Texto")).toBe("Oi.\n\nTexto");
  });

  it("validates title and body", () => {
    expect(cannedResponseInputSchema.safeParse({ title: "  Senha  ", body: "Passos" })).toMatchObject({ success: true, data: { title: "Senha" } });
    for (const input of [
      { title: "", body: "x" },
      { title: "x".repeat(121), body: "x" },
      { title: "Título", body: "   " },
      { title: "Título", body: "x".repeat(5001) },
      { title: "Título", body: "x", extra: 1 },
    ]) {
      expect(cannedResponseInputSchema.safeParse(input).success).toBe(false);
    }
  });
});

const record = (overrides: Partial<CannedResponseRecord>): CannedResponseRecord => ({
  id: "11111111-1111-4111-8111-111111111111",
  sectorId: "sector-a",
  title: "Título",
  body: "Olá, {{solicitante}}",
  isActive: true,
  createdByName: "Diego",
  updatedByName: "Diego",
  updatedAt: new Date(),
  ...overrides,
});

function repository(overrides: Partial<CannedResponseRepository> = {}) {
  const repo: CannedResponseRepository = {
    findAttendant: vi.fn(async (id: string) => (id === "diego" ? { id, name: "Diego Rocha", role: "ATTENDANT", isActive: true, sectorId: "sector-a" } : null)),
    findRequest: vi.fn(async (id: string) => ({ id, sectorId: "sector-a", requesterName: "Ana Paula", serviceName: "Reparo" })),
    listForSector: vi.fn(async () => [
      record({ id: "22222222-2222-4222-8222-222222222222", title: "Visita técnica", isActive: true }),
      record({ id: "33333333-3333-4333-8333-333333333333", title: "antigo", isActive: false }),
      record({ id: "44444444-4444-4444-8444-444444444444", title: "Acesso", body: "{{codigo}}", isActive: true }),
    ]),
    find: vi.fn(async (id: string) => (id === "11111111-1111-4111-8111-111111111111" ? record({}) : id === "55555555-5555-4555-8555-555555555555" ? record({ id, sectorId: "sector-b" }) : null)),
    create: vi.fn(async (input) => record({ title: input.title, body: input.body })),
    update: vi.fn(async () => undefined),
    setActive: vi.fn(async () => undefined),
    ...overrides,
  };
  return repo;
}

describe("use cases (4.1 to 4.5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorization.requireCurrentActor.mockResolvedValue({ id: "diego", role: "ATTENDANT", sectorId: "sector-a", isActive: true });
  });

  it("lists the sector's responses, active first then by title, and only the active ones for the form", async () => {
    const repo = repository();
    expect((await listSectorResponses(repo)).map(({ title }) => title)).toEqual(["Acesso", "Visita técnica", "antigo"]);
    expect((await listActiveResponses(repo)).map(({ title }) => title)).toEqual(["Acesso", "Visita técnica"]);
    expect(repo.listForSector).toHaveBeenCalledWith("sector-a");
  });

  it("renders the active responses for a request of the sector", async () => {
    const repo = repository();
    const requestId = "66666666-6666-4666-8666-666666666666";
    expect(await listResponsesForRequest(requestId, repo)).toEqual([
      { id: "44444444-4444-4444-8444-444444444444", title: "Acesso", text: "66666666" },
      { id: "22222222-2222-4222-8222-222222222222", title: "Visita técnica", text: "Olá, Ana" },
    ]);
  });

  it("refuses a request of another sector", async () => {
    const repo = repository({ findRequest: vi.fn(async (id: string) => ({ id, sectorId: "sector-b", requesterName: "X", serviceName: "Y" })) });
    await expect(listResponsesForRequest("66666666-6666-4666-8666-666666666666", repo)).rejects.toThrow(NotFoundError);
  });

  it("creates with the sector and the author from the database", async () => {
    const repo = repository();
    await createCannedResponse({ title: " Visita ", body: "Amanhã" }, repo);
    expect(repo.create).toHaveBeenCalledWith({ sectorId: "sector-a", title: "Visita", body: "Amanhã", actorId: "diego" });
    await expect(createCannedResponse({ title: "", body: "x" }, repo)).rejects.toThrow(ValidationError);
  });

  it("changes only responses of the own sector, and refuses a no-op activation", async () => {
    const repo = repository();
    await updateCannedResponse("11111111-1111-4111-8111-111111111111", { title: "Novo", body: "Texto" }, repo);
    expect(repo.update).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", { title: "Novo", body: "Texto", actorId: "diego" });
    await expect(updateCannedResponse("55555555-5555-4555-8555-555555555555", { title: "x", body: "y" }, repo)).rejects.toThrow(NotFoundError);
    await expect(setCannedResponseActive("11111111-1111-4111-8111-111111111111", true, repo)).rejects.toThrow(ConflictError);
    await setCannedResponseActive("11111111-1111-4111-8111-111111111111", false, repo);
    expect(repo.setActive).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", false, "diego");
  });

  it.each([
    ["a requester", { id: "rita", role: "REQUESTER", isActive: true, sectorId: null }],
    ["a manager", { id: "gabi", role: "MANAGER", isActive: true, sectorId: "sector-a" }],
    ["an inactive attendant", { id: "old", role: "ATTENDANT", isActive: false, sectorId: "sector-a" }],
    ["an attendant without sector", { id: "free", role: "ATTENDANT", isActive: true, sectorId: null }],
  ])("refuses %s", async (_case, person) => {
    authorization.requireCurrentActor.mockResolvedValue(person);
    const repo = repository({ findAttendant: vi.fn(async () => ({ ...person, name: "x" })) });
    await expect(listSectorResponses(repo)).rejects.toThrow(NotFoundError);
    await expect(createCannedResponse({ title: "a", body: "b" }, repo)).rejects.toThrow(NotFoundError);
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe("picker (4.4)", () => {
  it("renders nothing without responses, and a select with an Inserir button otherwise", () => {
    expect(renderToStaticMarkup(createElement(CannedResponsePicker, { responses: [], targetId: "comment-body" }))).toBe("");
    const html = renderToStaticMarkup(
      createElement(CannedResponsePicker, { responses: [{ id: "a", title: "Visita técnica", text: "Olá" }], targetId: "comment-body" }),
    );
    expect(html).toContain("Inserir resposta pronta");
    expect(html).toContain(">Visita técnica</option>");
    expect(html).toContain('type="button"');
    expect(html).not.toContain('type="submit"');
  });
});
