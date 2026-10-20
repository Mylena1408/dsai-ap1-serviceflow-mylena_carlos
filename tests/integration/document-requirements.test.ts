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

const session = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import {
  createDocumentRequirement,
  deactivateDocumentRequirement,
  listDocumentRequirements,
  moveDocumentRequirement,
  updateDocumentRequirement,
} from "@/modules/document-requirements";

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

async function actAsAdmin() {
  const admin = await createDomainUser({ role: "ADMIN" });
  setSessionActor(admin);
  return admin;
}

async function createServiceContext(isActive = true) {
  const category = await createDomainCategory();
  const sector = await createDomainSector();
  const service = await createDomainService({
    categoryId: category.id,
    sectorId: sector.id,
    isActive,
  });

  return { category, sector, service };
}

function requirementInput(name: string, overrides: Record<string, unknown> = {}) {
  return { name, isRequired: true, acceptedFormats: ["PDF"], ...overrides };
}

async function activeOrder(serviceId: string): Promise<string[]> {
  const requirements = await prisma.serviceDocumentRequirement.findMany({
    where: { serviceId, isActive: true },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { name: true },
  });

  return requirements.map((requirement) => requirement.name);
}

describe("document requirement configuration (SF-032)", () => {
  it("lets an administrator create requirements in order with server-defined fields", async () => {
    await actAsAdmin();
    const { service } = await createServiceContext();

    const first = await createDocumentRequirement(
      service.id,
      requirementInput("  Requerimento de férias  ", { acceptedFormats: ["PDF", "DOCX"] }),
      prisma,
    );
    const second = await createDocumentRequirement(
      service.id,
      requirementInput("Documento de autorização", { isRequired: false, acceptedFormats: ["TXT"] }),
      prisma,
    );

    expect(first).toMatchObject({
      serviceId: service.id,
      name: "Requerimento de férias",
      isRequired: true,
      acceptedFormats: ["PDF", "DOCX"],
      position: 0,
      isActive: true,
    });
    expect(second).toMatchObject({ isRequired: false, acceptedFormats: ["TXT"], position: 1 });
    await expect(listDocumentRequirements(prisma)).resolves.toHaveLength(2);
  });

  it("allows configuring an inactive service", async () => {
    await actAsAdmin();
    const { service } = await createServiceContext(false);

    await expect(
      createDocumentRequirement(service.id, requirementInput("Formulário de alteração"), prisma),
    ).resolves.toMatchObject({ serviceId: service.id });
  });

  it("rejects a sixth active requirement and allows a new one after a deactivation (CA-DOC-02)", async () => {
    await actAsAdmin();
    const { service } = await createServiceContext();
    const created = [];

    for (let index = 1; index <= 5; index += 1) {
      created.push(
        await createDocumentRequirement(service.id, requirementInput(`Documento ${index}`), prisma),
      );
    }

    await expect(
      createDocumentRequirement(service.id, requirementInput("Documento 6"), prisma),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(prisma.serviceDocumentRequirement.count()).resolves.toBe(5);

    await deactivateDocumentRequirement(created[0].id, prisma);
    await expect(
      createDocumentRequirement(service.id, requirementInput("Documento 6"), prisma),
    ).resolves.toMatchObject({ position: 5 });
  });

  it("enforces case-insensitive unique names among active requirements of the same service", async () => {
    await actAsAdmin();
    const { service } = await createServiceContext();
    const { service: otherService } = await createServiceContext();
    const original = await createDocumentRequirement(
      service.id,
      requirementInput("Comprovante"),
      prisma,
    );

    await expect(
      createDocumentRequirement(service.id, requirementInput("COMPROVANTE"), prisma),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      createDocumentRequirement(otherService.id, requirementInput("comprovante"), prisma),
    ).resolves.toMatchObject({ serviceId: otherService.id });

    await deactivateDocumentRequirement(original.id, prisma);
    await expect(
      createDocumentRequirement(service.id, requirementInput("comprovante"), prisma),
    ).resolves.toMatchObject({ isActive: true });
  });

  it.each([
    ["an empty name", { name: "   " }],
    ["a name above 120 characters", { name: "a".repeat(121) }],
    ["empty formats", { acceptedFormats: [] }],
    ["an unsupported format", { acceptedFormats: ["EXE"] }],
  ])("rejects %s without persisting (CA-DOC-02)", async (_label, overrides) => {
    await actAsAdmin();
    const { service } = await createServiceContext();

    await expect(
      createDocumentRequirement(service.id, { ...requirementInput("Documento"), ...overrides }, prisma),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(prisma.serviceDocumentRequirement.count()).resolves.toBe(0);
  });

  it("rejects unknown services and malformed identifiers", async () => {
    await actAsAdmin();

    await expect(
      createDocumentRequirement("6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4", requirementInput("Doc"), prisma),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createDocumentRequirement("not-a-uuid", requirementInput("Doc"), prisma),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("edits only name, flag and formats, never the owning service (CA-DOC-03)", async () => {
    await actAsAdmin();
    const { service } = await createServiceContext();
    const { service: otherService } = await createServiceContext();
    const requirement = await createDocumentRequirement(service.id, requirementInput("Escala"), prisma);
    await createDocumentRequirement(service.id, requirementInput("Formulário"), prisma);

    await expect(
      updateDocumentRequirement(
        requirement.id,
        { ...requirementInput("Escala"), serviceId: otherService.id },
        prisma,
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    const updated = await updateDocumentRequirement(
      requirement.id,
      requirementInput("Documento da escala", { isRequired: false, acceptedFormats: ["DOCX", "TXT"] }),
      prisma,
    );

    expect(updated).toMatchObject({
      serviceId: service.id,
      name: "Documento da escala",
      isRequired: false,
      acceptedFormats: ["DOCX", "TXT"],
      position: 0,
      isActive: true,
    });
    await expect(
      updateDocumentRequirement(requirement.id, requirementInput("FORMULÁRIO"), prisma),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("keeps inactive requirements as history: no edit, no move, idempotent deactivation", async () => {
    await actAsAdmin();
    const { service } = await createServiceContext();
    const requirement = await createDocumentRequirement(service.id, requirementInput("Antigo"), prisma);

    await deactivateDocumentRequirement(requirement.id, prisma);
    await expect(deactivateDocumentRequirement(requirement.id, prisma)).resolves.toMatchObject({
      isActive: false,
    });
    await expect(
      updateDocumentRequirement(requirement.id, requirementInput("Novo nome"), prisma),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(moveDocumentRequirement(requirement.id, "up", prisma)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(
      prisma.serviceDocumentRequirement.findUniqueOrThrow({ where: { id: requirement.id } }),
    ).resolves.toMatchObject({ name: "Antigo", isActive: false });
  });

  it("moves requirements up and down within one service, with no effect at the edges", async () => {
    await actAsAdmin();
    const { service } = await createServiceContext();
    const { service: otherService } = await createServiceContext();
    const a = await createDocumentRequirement(service.id, requirementInput("A"), prisma);
    const b = await createDocumentRequirement(service.id, requirementInput("B"), prisma);
    const c = await createDocumentRequirement(service.id, requirementInput("C"), prisma);
    await createDocumentRequirement(otherService.id, requirementInput("X"), prisma);
    await createDocumentRequirement(otherService.id, requirementInput("Y"), prisma);

    await moveDocumentRequirement(c.id, "up", prisma);
    expect(await activeOrder(service.id)).toEqual(["A", "C", "B"]);

    await moveDocumentRequirement(a.id, "down", prisma);
    expect(await activeOrder(service.id)).toEqual(["C", "A", "B"]);

    await moveDocumentRequirement(c.id, "up", prisma);
    await moveDocumentRequirement(b.id, "down", prisma);
    expect(await activeOrder(service.id)).toEqual(["C", "A", "B"]);
    expect(await activeOrder(otherService.id)).toEqual(["X", "Y"]);

    await expect(moveDocumentRequirement(a.id, "sideways", prisma)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("does not change attachments or snapshots of existing requests", async () => {
    await actAsAdmin();
    const { service, sector } = await createServiceContext();
    const requester = await createDomainUser({ role: "REQUESTER" });
    const requirement = await createDocumentRequirement(service.id, requirementInput("Original"), prisma);
    const request = await createDomainRequest({
      requesterId: requester.id,
      serviceId: service.id,
      sectorId: sector.id,
    });
    const attachmentId = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
    await prisma.requestAttachment.create({
      data: {
        id: attachmentId,
        requestId: request.id,
        requirementId: requirement.id,
        requirementNameSnapshot: "Original",
        requirementRequiredSnapshot: true,
        originalFilename: "sintetico.pdf",
        detectedFormat: "PDF",
        contentType: "application/pdf",
        sizeBytes: 10,
        sha256: "a".repeat(64),
        storageKey: `requests/${request.id}/${attachmentId}`,
        uploadedById: requester.id,
      },
    });

    await updateDocumentRequirement(
      requirement.id,
      requirementInput("Renomeado", { isRequired: false }),
      prisma,
    );
    await deactivateDocumentRequirement(requirement.id, prisma);

    await expect(
      prisma.requestAttachment.findUniqueOrThrow({ where: { id: attachmentId } }),
    ).resolves.toMatchObject({
      requirementId: requirement.id,
      requirementNameSnapshot: "Original",
      requirementRequiredSnapshot: true,
    });
  });

  it.each<[string, Role]>([
    ["requester", "REQUESTER"],
    ["attendant", "ATTENDANT"],
  ])("denies every operation to a %s (CA-DOC-01)", async (_label, role) => {
    const sector = await createDomainSector();
    const actor = await createDomainUser({
      role,
      sectorId: role === "ATTENDANT" ? sector.id : null,
    });
    const { service } = await createServiceContext();
    await actAsAdmin();
    const requirement = await createDocumentRequirement(service.id, requirementInput("Doc"), prisma);
    setSessionActor(actor);

    await expect(listDocumentRequirements(prisma)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      createDocumentRequirement(service.id, requirementInput("Outro"), prisma),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      updateDocumentRequirement(requirement.id, requirementInput("Alterado"), prisma),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(moveDocumentRequirement(requirement.id, "down", prisma)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(deactivateDocumentRequirement(requirement.id, prisma)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(
      prisma.serviceDocumentRequirement.findMany({ select: { name: true, isActive: true } }),
    ).resolves.toEqual([{ name: "Doc", isActive: true }]);
  });

  it("denies unauthenticated and inactive actors", async () => {
    const { service } = await createServiceContext();
    const inactiveAdmin = await createDomainUser({ role: "ADMIN", isActive: false });

    setSessionActor(null);
    await expect(
      createDocumentRequirement(service.id, requirementInput("Doc"), prisma),
    ).rejects.toBeInstanceOf(AuthenticationError);

    setSessionActor(inactiveAdmin);
    await expect(
      createDocumentRequirement(service.id, requirementInput("Doc"), prisma),
    ).rejects.toBeInstanceOf(AuthenticationError);
    await expect(prisma.serviceDocumentRequirement.count()).resolves.toBe(0);
  });
});
