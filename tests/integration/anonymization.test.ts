import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { RequestStatus, User } from "@prisma/client";
import { prisma } from "./fixtures";
import {
  createDomainCategory,
  createDomainRequest,
  createDomainSector,
  createDomainService,
  createDomainUser,
} from "./domain-fixtures";
import { minimalPdf } from "../unit/modules/attachments/synthetic-files";

// SPEC 2026-11-02-auditoria-lgpd, 5.5 (SF-107; CA-AUD-07, CA-AUD-08 and CA-AUD-09).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { authenticateCredentials } from "@/modules/auth/application/authenticate-credentials";
import { createPrismaAuthUserRepository } from "@/modules/auth/infrastructure/prisma-auth-repository";
import { argon2PasswordHasher, hashPassword } from "@/modules/auth/infrastructure/argon2-password";
import { getDashboard } from "@/modules/reports";
import { listRequestAttachments } from "@/modules/requests";
import { listAuditTrail } from "@/modules/audit";
import { anonymizeUser, setUserActive, updateUser } from "@/modules/users";
import { createMemoryDocumentStorage } from "@/server/storage";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { GET as downloadAttachment } from "@/app/api/requests/[requestId]/attachments/[attachmentId]/route";

const REMOVED = "[conteúdo removido na anonimização]";

function actAs(user: Pick<User, "id" | "name" | "email" | "role" | "sectorId" | "isActive">) {
  session.getCurrentUser.mockResolvedValue({ ...user });
}

/**
 * Carla, a requester who left, has a completed request in Diego's sector: description, a text
 * and a number answer, comments by both, a note in the history, a document, notifications, an
 * e-mail preference, a permission and earlier audit entries about her.
 */
async function scenario(status: RequestStatus = "COMPLETED") {
  const admin = await createDomainUser({ role: "ADMIN" });
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const carla = await prisma.user.create({
    data: {
      name: "Carla Mendes",
      email: "carla@exemplo.test",
      role: "REQUESTER",
      passwordHash: await hashPassword("senha-da-carla"),
    },
  });
  const diego = await prisma.user.create({
    data: { name: "Diego Rocha", email: "diego@exemplo.test", role: "ATTENDANT", sectorId: sector.id, passwordHash: "$argon2id$diego" },
  });

  const request = await createDomainRequest({ requesterId: carla.id, serviceId: service.id, sectorId: sector.id, status });
  await prisma.request.update({
    where: { id: request.id },
    data: { description: "A tomada da sala 12 da Carla não funciona.", assigneeId: diego.id, completedAt: status === "COMPLETED" ? new Date() : null },
  });
  const [textField, numberField] = await Promise.all([
    prisma.serviceField.create({ data: { serviceId: service.id, label: "Sala", type: "SHORT_TEXT", isRequired: true, options: [], position: 0 } }),
    prisma.serviceField.create({ data: { serviceId: service.id, label: "Andar", type: "INTEGER", isRequired: true, options: [], position: 1 } }),
  ]);
  await prisma.requestFieldValue.createMany({
    data: [
      { requestId: request.id, fieldId: textField.id, labelSnapshot: "Sala", typeSnapshot: "SHORT_TEXT", positionSnapshot: 0, value: "Sala da Carla" },
      { requestId: request.id, fieldId: numberField.id, labelSnapshot: "Andar", typeSnapshot: "INTEGER", positionSnapshot: 1, value: "3" },
    ],
  });
  await prisma.requestComment.createMany({
    data: [
      { requestId: request.id, authorId: carla.id, body: "Meu ramal é 1234, Carla." },
      { requestId: request.id, authorId: diego.id, body: "Vamos amanhã." },
    ],
  });
  await prisma.requestStatusEvent.createMany({
    data: [
      { requestId: request.id, actorId: carla.id, toStatus: "OPEN" },
      { requestId: request.id, actorId: carla.id, fromStatus: "OPEN", toStatus: "OPEN", note: "Reaberta pela Carla" },
      { requestId: request.id, actorId: diego.id, fromStatus: "OPEN", toStatus: "IN_PROGRESS", note: "Diego assumiu" },
    ],
  });

  const requirement = await prisma.serviceDocumentRequirement.create({
    data: { serviceId: service.id, name: "Comprovante", isRequired: true, position: 0, acceptedFormats: ["PDF"] },
  });
  const storage = createMemoryDocumentStorage();
  const content = minimalPdf();
  const attachmentId = randomUUID();
  const storageKey = `requests/${request.id}/${attachmentId}`;
  await storage.put(storageKey, content, "application/pdf");
  const { createHash } = await import("node:crypto");
  await prisma.requestAttachment.create({
    data: {
      id: attachmentId,
      requestId: request.id,
      requirementId: requirement.id,
      requirementNameSnapshot: "Comprovante",
      requirementRequiredSnapshot: true,
      originalFilename: "rg-carla-mendes.pdf",
      detectedFormat: "PDF",
      contentType: "application/pdf",
      sizeBytes: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
      storageKey,
      uploadedById: carla.id,
    },
  });

  const notification = await prisma.requestNotification.create({
    data: { recipientId: carla.id, requestId: request.id, type: "request.status_changed", createdAt: new Date() },
  });
  await prisma.emailDelivery.create({
    data: { notificationId: notification.id, recipientId: carla.id, availableAt: new Date(), createdAt: new Date() },
  });
  await prisma.requestNotification.create({
    data: { recipientId: diego.id, requestId: request.id, type: "request.created", createdAt: new Date() },
  });
  await prisma.notificationPreference.create({ data: { userId: carla.id, category: "STATUS", emailEnabled: true, updatedAt: new Date() } });
  await prisma.userPermission.create({
    data: { userId: carla.id, permission: "SECTOR_REQUESTS_READ", grantedById: admin.id, grantedAt: new Date() },
  });

  // Earlier administration of Carla's account, recorded with her name of the time.
  actAs(admin);
  await updateUser(carla.id, { name: "Carla Mendes", email: "carla@exemplo.test", role: "REQUESTER", sectorId: null });
  await setUserActive(carla.id, false);

  return { admin, carla, diego, request, attachmentId, storage, storageKey };
}

describe("anonymization over the database (SF-107)", () => {
  it("removes identity, written content, files and notification data, and keeps requests and numbers (CA-AUD-08)", async () => {
    const { admin, carla, diego, request, attachmentId, storage, storageKey } = await scenario();
    const dashboardBefore = await getDashboard({}, prisma);

    const result = await anonymizeUser({ userId: carla.id, confirmed: true }, prisma, storage);

    const person = await prisma.user.findUniqueOrThrow({ where: { id: carla.id } });
    expect(result).toEqual({ id: carla.id, name: person.name });
    expect(person.name).toMatch(/^Pessoa anonimizada [0-9a-f]{12}$/);
    expect(person.email).toMatch(/^anonimizado-[0-9a-f]{12}@anonimizado\.invalid$/);
    expect(person.anonymizedAt).not.toBeNull();
    expect(person.isActive).toBe(false);

    // The account no longer authenticates, even with the old password.
    const users = createPrismaAuthUserRepository(prisma);
    for (const email of ["carla@exemplo.test", person.email]) {
      await expect(authenticateCredentials({ email, password: "senha-da-carla" }, users, argon2PasswordHasher)).resolves.toBeNull();
    }

    const stored = await prisma.request.findUniqueOrThrow({
      where: { id: request.id },
      include: {
        fieldValues: { orderBy: { positionSnapshot: "asc" } },
        comments: { orderBy: { body: "asc" } },
        events: { orderBy: { note: "asc" } },
        attachments: true,
      },
    });
    expect(stored).toMatchObject({ status: "COMPLETED", requesterId: carla.id, assigneeId: diego.id, description: REMOVED });
    expect(stored.fieldValues.map(({ value }) => value)).toEqual([REMOVED, "3"]);
    expect(stored.comments.map(({ body }) => body).sort()).toEqual([REMOVED, "Vamos amanhã."].sort());
    expect(stored.events).toHaveLength(3);
    expect(stored.events.map(({ note }) => note).sort()).toEqual(["Diego assumiu", REMOVED, null].sort());
    expect(stored.attachments).toEqual([
      expect.objectContaining({ id: attachmentId, originalFilename: "Arquivo removido na anonimização", removedAt: expect.any(Date) }),
    ]);
    expect(storage.size).toBe(0);
    await expect(storage.get(storageKey)).rejects.toThrow();

    // Diego's notification stays; Carla's notifications, e-mails, preferences and permissions go.
    await expect(prisma.requestNotification.findMany({ select: { recipientId: true } })).resolves.toEqual([{ recipientId: diego.id }]);
    await expect(prisma.emailDelivery.count()).resolves.toBe(0);
    await expect(prisma.notificationPreference.count({ where: { userId: carla.id } })).resolves.toBe(0);
    await expect(prisma.userPermission.count({ where: { userId: carla.id } })).resolves.toBe(0);
    await expect(prisma.userPermissionEvent.findMany({ where: { userId: carla.id } })).resolves.toEqual([
      expect.objectContaining({ permission: "SECTOR_REQUESTS_READ", action: "REVOKED", actorId: admin.id }),
    ]);

    // Dashboard numbers do not change.
    const dashboardAfter = await getDashboard({}, prisma);
    expect(dashboardAfter.totals).toEqual(dashboardBefore.totals);
    expect(dashboardAfter.current).toEqual(dashboardBefore.current);

    // Diego, who has the request in his sector, sees the file as removed and cannot download it.
    actAs(diego);
    await expect(listRequestAttachments(request.id, prisma)).resolves.toEqual([
      expect.objectContaining({ id: attachmentId, originalFilename: "Arquivo removido na anonimização", removedAt: expect.any(Date) }),
    ]);
    const response = await downloadAttachment(new Request("http://localhost"), {
      params: Promise.resolve({ requestId: request.id, attachmentId }),
    });
    expect(response.status).toBe(404);

    // The old name and e-mail are nowhere in the database rows that mention Carla.
    const rows = JSON.stringify(
      await Promise.all([
        prisma.user.findUnique({ where: { id: carla.id } }),
        prisma.request.findMany({ include: { fieldValues: true, comments: true, events: true, attachments: true } }),
        prisma.auditEntry.findMany(),
      ]),
    );
    for (const absent of ["Carla", "carla@", "rg-carla", "ramal", "tomada"]) {
      expect(rows).not.toContain(absent);
    }
  });

  it("records the anonymization in the audit without the old name or e-mail (CA-AUD-09)", async () => {
    const { admin, carla, storage } = await scenario();

    await anonymizeUser({ userId: carla.id, confirmed: true }, prisma, storage);

    const person = await prisma.user.findUniqueOrThrow({ where: { id: carla.id } });
    const entries = await prisma.auditEntry.findMany({ where: { entityId: carla.id }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }] });
    expect(entries.map(({ action }) => action)).toEqual(["DEACTIVATED", "ANONYMIZED"]);
    expect(entries.every(({ entityLabel }) => entityLabel === person.name)).toBe(true);
    expect(entries[1]).toMatchObject({
      actorId: admin.id,
      actorRole: "ADMIN",
      entityType: "USER",
      changes: [
        { field: "name", personal: true },
        { field: "email", personal: true },
      ],
    });

    const trail = await listAuditTrail({}, prisma);
    const shown = JSON.stringify(trail);
    expect(shown).toContain("Pessoa anonimizada");
    expect(shown).not.toContain("Carla");
    expect(shown).not.toContain("carla@");
  });

  it("refuses outside the conditions of 5.5.1 and changes nothing (CA-AUD-07)", async () => {
    const { admin, carla, diego, request, storage } = await scenario("IN_PROGRESS");
    const snapshot = async () =>
      JSON.stringify(
        await Promise.all([
          prisma.user.findMany({ orderBy: { id: "asc" } }),
          prisma.request.findMany({ include: { fieldValues: true, comments: true, events: true, attachments: true } }),
          prisma.requestNotification.count(),
          prisma.notificationPreference.count(),
          prisma.userPermission.count(),
          prisma.auditEntry.count(),
        ]),
      );
    const before = await snapshot();

    // Request in attendance with Carla as requester; Diego is active and responsible for it.
    await expect(anonymizeUser({ userId: carla.id, confirmed: true }, prisma, storage)).rejects.toBeInstanceOf(ConflictError);
    await expect(anonymizeUser({ userId: diego.id, confirmed: true }, prisma, storage)).rejects.toBeInstanceOf(ConflictError);
    // Oneself, without confirmation, unknown people.
    await expect(anonymizeUser({ userId: admin.id, confirmed: true }, prisma, storage)).rejects.toBeInstanceOf(ConflictError);
    await expect(anonymizeUser({ userId: carla.id }, prisma, storage)).rejects.toBeInstanceOf(ValidationError);
    await expect(anonymizeUser({ userId: randomUUID(), confirmed: true }, prisma, storage)).rejects.toBeInstanceOf(NotFoundError);

    expect(await snapshot()).toBe(before);
    expect(storage.size).toBe(1);

    // Once the request is closed and Diego is no longer responsible for anything open, Carla can go.
    await prisma.request.update({ where: { id: request.id }, data: { status: "COMPLETED", completedAt: new Date() } });
    await expect(anonymizeUser({ userId: carla.id, confirmed: true }, prisma, storage)).resolves.toMatchObject({ id: carla.id });
  });

  it("refuses non-administrators and a second anonymization, and blocks editing the anonymized person", async () => {
    const { admin, carla, diego, storage } = await scenario();

    actAs(diego);
    await expect(anonymizeUser({ userId: carla.id, confirmed: true }, prisma, storage)).rejects.toThrow();
    await expect(prisma.user.findUniqueOrThrow({ where: { id: carla.id } })).resolves.toMatchObject({ name: "Carla Mendes" });

    actAs(admin);
    await anonymizeUser({ userId: carla.id, confirmed: true }, prisma, storage);
    const auditCount = await prisma.auditEntry.count();

    await expect(anonymizeUser({ userId: carla.id, confirmed: true }, prisma, storage)).rejects.toBeInstanceOf(ConflictError);
    await expect(setUserActive(carla.id, true)).rejects.toBeInstanceOf(ConflictError);
    await expect(
      updateUser(carla.id, { name: "Carla Mendes", email: "carla@exemplo.test", role: "REQUESTER", sectorId: null }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(prisma.auditEntry.count()).resolves.toBe(auditCount);
  });

  it("rolls back every change when the storage fails, so the administrator can try again", async () => {
    const { carla, storage, storageKey } = await scenario();
    const failing = { remove: vi.fn(async () => Promise.reject(new Error("storage down"))) };

    await expect(anonymizeUser({ userId: carla.id, confirmed: true }, prisma, failing)).rejects.toThrow("storage down");

    await expect(prisma.user.findUniqueOrThrow({ where: { id: carla.id } })).resolves.toMatchObject({
      name: "Carla Mendes",
      anonymizedAt: null,
    });
    await expect(prisma.requestAttachment.count({ where: { removedAt: { not: null } } })).resolves.toBe(0);
    await expect(prisma.auditEntry.count({ where: { action: "ANONYMIZED" } })).resolves.toBe(0);

    await anonymizeUser({ userId: carla.id, confirmed: true }, prisma, storage);
    await expect(storage.get(storageKey)).rejects.toThrow();
  });
});
