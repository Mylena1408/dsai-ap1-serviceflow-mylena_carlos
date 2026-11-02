import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError, NotFoundError } from "@/server/errors";
import type { PersonalDataReader } from "@/modules/audit/application/ports";
import { buildPersonalDataExport, personalDataFileName, type PersonalDataSource } from "@/modules/audit/domain/personal-data";

const authorization = vi.hoisted(() => ({ requireCurrentActor: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import { exportPersonalData } from "@/modules/audit/application/personal-data";

// SPEC 2026-11-02-auditoria-lgpd, 5.4 (SF-106; CA-AUD-06).

const now = new Date("2026-11-02T15:00:00.000Z");

const source: PersonalDataSource = {
  person: {
    name: "Carla Mendes",
    email: "carla.mendes@exemplo.test",
    role: "REQUESTER",
    sectorName: null,
    isActive: true,
    createdAt: new Date("2026-10-01T12:00:00.000Z"),
    updatedAt: new Date("2026-10-02T12:00:00.000Z"),
  },
  emailCategories: ["STATUS", "SLA"],
  requests: [
    {
      id: "3f2a9c1e-0000-4000-8000-000000000001",
      serviceName: "Reparo elétrico",
      categoryName: "Manutenção",
      sectorName: "Infraestrutura",
      description: "A tomada da sala 12 não funciona.",
      status: "IN_PROGRESS",
      priority: "HIGH",
      approvalState: "APPROVED",
      createdAt: new Date("2026-10-30T12:00:00.000Z"),
      completedAt: null,
      cancelledAt: null,
      dueAt: new Date("2026-11-01T12:00:00.000Z"),
      answers: [{ label: "Sala", value: "12" }],
      history: [
        { occurredAt: new Date("2026-10-30T12:00:00.000Z"), toStatus: "OPEN", actorName: "Carla Mendes", note: null },
        { occurredAt: new Date("2026-10-31T09:00:00.000Z"), toStatus: "IN_PROGRESS", actorName: "Diego Rocha", note: null },
      ],
      comments: [
        { createdAt: new Date("2026-10-31T10:00:00.000Z"), authorName: "Diego Rocha", body: "Vamos amanhã.", isInternal: false },
        // Would never come from the reader; the file drops it anyway.
        { createdAt: new Date("2026-10-31T11:00:00.000Z"), authorName: "Diego Rocha", body: "Nota só da equipe", isInternal: true },
      ],
      attachments: [
        { requirementName: "Foto", filename: "tomada.pdf", createdAt: new Date("2026-10-30T12:00:00.000Z"), removed: false },
        { requirementName: "Planta", filename: "planta.pdf", createdAt: new Date("2026-10-30T12:00:00.000Z"), removed: true },
      ],
    },
  ],
  writtenElsewhere: [
    {
      requestId: "a1b2c3d4-0000-4000-8000-000000000002",
      serviceName: "Declaração de vínculo",
      createdAt: new Date("2026-10-20T10:00:00.000Z"),
      body: "Enviei o documento.",
      isInternal: false,
    },
  ],
  notifications: [
    { createdAt: new Date("2026-10-31T09:00:00.000Z"), readAt: null, type: "status.IN_PROGRESS", serviceName: "Reparo elétrico" },
  ],
  permissions: [{ permission: "SECTOR_SERVICES", grantedAt: new Date("2026-10-15T12:00:00.000Z") }],
};

describe("content of \"Meus dados\" (CA-AUD-06)", () => {
  it("brings the profile, email choices, own requests, written comments, notifications and permissions", () => {
    const file = buildPersonalDataExport(source, now);

    expect(file.geradoEm).toBe("2026-11-02T15:00:00.000Z");
    expect(file.pessoa).toEqual({
      nome: "Carla Mendes",
      email: "carla.mendes@exemplo.test",
      perfil: "Solicitante",
      setor: null,
      ativa: true,
      criadaEm: "2026-10-01T12:00:00.000Z",
      atualizadaEm: "2026-10-02T12:00:00.000Z",
    });
    expect(file.emailsQueVoceEscolheuReceber).toEqual(["Mudanças de status", "Prazos próximos e vencidos"]);
    expect(file.solicitacoesQueVoceAbriu[0]).toEqual({
      codigo: "3F2A9C1E",
      servico: "Reparo elétrico",
      categoria: "Manutenção",
      setor: "Infraestrutura",
      descricao: "A tomada da sala 12 não funciona.",
      status: "Em atendimento",
      prioridade: "Alta",
      aprovacao: "Aprovada",
      abertaEm: "2026-10-30T12:00:00.000Z",
      concluidaEm: null,
      canceladaEm: null,
      vencimento: "2026-11-01T12:00:00.000Z",
      respostas: [{ campo: "Sala", valor: "12" }],
      historico: [
        { quando: "2026-10-30T12:00:00.000Z", status: "Aberta", por: "Carla Mendes", justificativa: null },
        { quando: "2026-10-31T09:00:00.000Z", status: "Em atendimento", por: "Diego Rocha", justificativa: null },
      ],
      comentarios: [{ quando: "2026-10-31T10:00:00.000Z", autor: "Diego Rocha", texto: "Vamos amanhã." }],
      anexos: [
        { documento: "Foto", arquivo: "tomada.pdf", enviadoEm: "2026-10-30T12:00:00.000Z" },
        { documento: "Planta", arquivo: "Arquivo removido na anonimização", enviadoEm: "2026-10-30T12:00:00.000Z" },
      ],
    });
    expect(file.comentariosQueVoceEscreveuEmOutrasSolicitacoes).toEqual([
      { solicitacao: "A1B2C3D4", servico: "Declaração de vínculo", quando: "2026-10-20T10:00:00.000Z", notaInterna: false, texto: "Enviei o documento." },
    ]);
    expect(file.notificacoesRecentes).toEqual([
      { quando: "2026-10-31T09:00:00.000Z", texto: "Atendimento iniciado: Reparo elétrico", lida: false },
    ]);
    expect(file.permissoesRecebidas).toEqual([{ permissao: "Gerir serviços do setor", concedidaEm: "2026-10-15T12:00:00.000Z" }]);
  });

  it("never carries internal notes of others nor anything the source should not have", () => {
    const leaky = {
      ...source,
      person: { ...source.person, passwordHash: "$argon2id$secret" },
    } as PersonalDataSource;

    const text = JSON.stringify(buildPersonalDataExport(leaky, now));
    expect(text).not.toContain("Nota só da equipe");
    expect(text).not.toContain("argon2id");
  });

  it("names the file after the day in São Paulo", () => {
    expect(personalDataFileName(new Date("2026-11-02T02:00:00.000Z"))).toBe("serviceflow-meus-dados-2026-11-01.json");
  });
});

describe("download of \"Meus dados\" (CA-AUD-06)", () => {
  beforeEach(() => vi.clearAllMocks());

  function reader(data: PersonalDataSource | null = source): PersonalDataReader {
    return { load: vi.fn(async () => data), recordExport: vi.fn(async () => undefined) };
  }

  it("reads only the signed-in person, records the download and gives a JSON file", async () => {
    authorization.requireCurrentActor.mockResolvedValue({ id: "carla-1", role: "REQUESTER", sectorId: null, isActive: true });
    const port = reader();

    const file = await exportPersonalData(port, now);

    expect(port.load).toHaveBeenCalledWith("carla-1");
    expect(port.recordExport).toHaveBeenCalledWith({ id: "carla-1", role: "REQUESTER" });
    expect(file.fileName).toBe("serviceflow-meus-dados-2026-11-02.json");
    expect(JSON.parse(file.content).pessoa.nome).toBe("Carla Mendes");
  });

  it("works for every profile", async () => {
    for (const role of ["ADMIN", "ATTENDANT", "MANAGER"] as const) {
      authorization.requireCurrentActor.mockResolvedValue({ id: `${role}-1`, role, sectorId: null, isActive: true });
      await expect(exportPersonalData(reader(), now)).resolves.toMatchObject({ fileName: expect.any(String) });
    }
  });

  it("refuses without a session, before reading anything", async () => {
    authorization.requireCurrentActor.mockRejectedValue(new AuthenticationError());
    const port = reader();

    await expect(exportPersonalData(port, now)).rejects.toBeInstanceOf(AuthenticationError);
    expect(port.load).not.toHaveBeenCalled();
    expect(port.recordExport).not.toHaveBeenCalled();
  });

  it("records nothing when the person no longer exists", async () => {
    authorization.requireCurrentActor.mockResolvedValue({ id: "gone", role: "REQUESTER", sectorId: null, isActive: true });
    const port = reader(null);

    await expect(exportPersonalData(port, now)).rejects.toBeInstanceOf(NotFoundError);
    expect(port.recordExport).not.toHaveBeenCalled();
  });
});
