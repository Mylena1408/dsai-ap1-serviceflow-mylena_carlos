import { describe, expect, it } from "vitest";
import { prisma } from "./fixtures";
import {
  DEMO_CATALOG,
  DEMO_DOCUMENT_REQUIREMENTS,
  DEMO_REQUESTS,
  seedDemoData,
} from "../../scripts/demo-data";
import { ensureDemoDataLoaded } from "@/modules/demo";
import { signInAsDemoUser } from "@/modules/auth/infrastructure/prisma-demo-accounts";
import { authenticateCredentials } from "@/modules/auth/infrastructure/prisma-credentials";
import {
  DEMO_ACCOUNTS,
  DEMO_ROLES,
  DEMO_SECTOR_NAME,
  LEGACY_DEMO_EMAILS,
  LEGACY_DEMO_SECTOR_NAME,
} from "@/modules/auth/domain/demo-accounts";
import { slaSituation } from "@/modules/requests/domain/sla";
import { createDomainRequest } from "./domain-fixtures";

// SPEC 2026-09-30, sections 22.6, 22.7 and 25 (CA-DEMO-07, CA-DEMO-08, CA-FIC-01 to 04).
describe("demonstration data", () => {
  const now = new Date("2026-10-30T12:00:00.000Z");
  const requirementCount = DEMO_DOCUMENT_REQUIREMENTS.flatMap(({ requirements }) => requirements).length;

  it("loads the catalog, the six fictitious people, requests and requirements once", async () => {
    const first = await seedDemoData(prisma, now);
    const second = await seedDemoData(prisma, now);

    expect(first).toEqual({
      categories: 3,
      services: 9,
      users: 6,
      requestsCreated: DEMO_REQUESTS.length,
      requirementsCreated: requirementCount,
    });
    expect(second).toMatchObject({ requestsCreated: 0, requirementsCreated: 0 });

    await expect(prisma.sector.count()).resolves.toBe(1);
    await expect(prisma.category.count()).resolves.toBe(DEMO_CATALOG.length);
    await expect(prisma.service.count()).resolves.toBe(9);
    await expect(prisma.user.count()).resolves.toBe(6);
    await expect(prisma.request.count()).resolves.toBe(DEMO_REQUESTS.length);
    await expect(prisma.serviceDocumentRequirement.count()).resolves.toBe(requirementCount);
  });

  it("puts every service in the Central de Serviços and lists all statuses", async () => {
    await seedDemoData(prisma, now);

    const services = await prisma.service.findMany({ include: { sector: true } });
    expect(new Set(services.map(({ sector }) => sector.name))).toEqual(new Set([DEMO_SECTOR_NAME]));
    expect(DEMO_SECTOR_NAME).toBe("Central de Serviços");

    const statuses = await prisma.request.groupBy({ by: ["status"], _count: true });
    expect(statuses.map(({ status }) => status).sort()).toEqual(["CANCELLED", "COMPLETED", "IN_PROGRESS", "OPEN"]);
  });

  it("records a history consistent with each status, the assignee and the approval", async () => {
    await seedDemoData(prisma, now);
    const diego = await prisma.user.findUniqueOrThrow({ where: { email: DEMO_ACCOUNTS.ATTENDANT.email } });
    const paulo = await prisma.user.findUniqueOrThrow({ where: { email: DEMO_ACCOUNTS.MANAGER.email } });

    const requests = await prisma.request.findMany({
      include: {
        events: { orderBy: { occurredAt: "asc" } },
        assignmentEvents: true,
        // One decision per level since SPEC 2026-11-06-aprofundamento-configurabilidade; the demo has one.
        approvals: true,
      },
    });
    const expectedSteps: Record<string, string[]> = {
      OPEN: ["OPEN"],
      IN_PROGRESS: ["OPEN", "IN_PROGRESS"],
      COMPLETED: ["OPEN", "IN_PROGRESS", "COMPLETED"],
      CANCELLED: ["OPEN", "CANCELLED"],
    };

    for (const { approvals, ...request } of requests.map((row) => ({ ...row, approval: row.approvals[0] ?? null }))) {
      void approvals;
      expect(request.events.map(({ toStatus }) => toStatus)).toEqual(expectedSteps[request.status]);
      expect(request.events[0]).toMatchObject({ fromStatus: null, actorId: request.requesterId });
      expect(request.completedAt !== null).toBe(request.status === "COMPLETED");
      expect(request.cancelledAt !== null).toBe(request.status === "CANCELLED");
      expect(request.createdAt.getTime()).toBeLessThan(now.getTime());

      const started = request.events.some(({ toStatus }) => toStatus === "IN_PROGRESS");
      expect(request.assigneeId).toBe(started ? diego.id : null);
      expect(request.assignmentEvents).toHaveLength(started ? 1 : 0);

      if (request.approvalState === "REJECTED") {
        expect(request.approval).toMatchObject({ decision: "REJECTED", deciderId: paulo.id });
        expect(request.events.at(-1)).toMatchObject({ actorId: paulo.id, note: request.approval?.note });
      }
      if (request.approvalState === "APPROVED") {
        expect(request.approval).toMatchObject({ decision: "APPROVED", deciderId: paulo.id });
      }
      if (request.approvalState === "PENDING" || request.approvalState === "REJECTED") {
        expect(request.dueAt).toBeNull();
      }
    }

    expect(new Set(requests.map(({ approvalState }) => approvalState))).toEqual(
      new Set([null, "PENDING", "APPROVED", "REJECTED"]),
    );
  });

  it("shows every deadline situation, the conversation and the notifications", async () => {
    await seedDemoData(prisma, now);

    const requests = await prisma.request.findMany({ where: { status: { in: ["OPEN", "IN_PROGRESS"] }, dueAt: { not: null } } });
    const situations = new Set(requests.map((request) => slaSituation(request, now)));
    expect(situations).toEqual(new Set(["on_time", "due_soon", "overdue"]));
    expect(
      await prisma.request.count({ where: { status: "COMPLETED", completedLate: true } }),
    ).toBeGreaterThan(0);
    expect(
      await prisma.request.count({ where: { status: "COMPLETED", completedLate: false } }),
    ).toBeGreaterThan(0);

    await expect(prisma.requestComment.count({ where: { isInternal: true } })).resolves.toBe(1);
    await expect(prisma.requestComment.count({ where: { isInternal: false } })).resolves.toBeGreaterThan(1);
    await expect(prisma.requestFieldValue.count()).resolves.toBeGreaterThan(0);

    for (const role of ["REQUESTER", "ATTENDANT", "MANAGER"] as const) {
      const person = await prisma.user.findUniqueOrThrow({ where: { email: DEMO_ACCOUNTS[role].email } });
      await expect(
        prisma.requestNotification.count({ where: { recipientId: person.id, readAt: null } }),
      ).resolves.toBeGreaterThan(0);
    }
  });

  it("loads on the first click only and keeps the administrator's changes afterwards", async () => {
    await expect(ensureDemoDataLoaded(prisma, now)).resolves.toMatchObject({ requestsCreated: DEMO_REQUESTS.length });

    const service = await prisma.service.findFirstOrThrow({ where: { name: "Reparo elétrico" } });
    await prisma.service.update({ where: { id: service.id }, data: { isActive: false } });

    await expect(ensureDemoDataLoaded(prisma, now)).resolves.toBeNull();
    await expect(prisma.request.count()).resolves.toBe(DEMO_REQUESTS.length);
    await expect(prisma.service.findUniqueOrThrow({ where: { id: service.id } })).resolves.toMatchObject({ isActive: false });
  });

  it("deactivates the generic accounts and renames the old demonstration sector", async () => {
    const legacySector = await prisma.sector.create({ data: { name: LEGACY_DEMO_SECTOR_NAME } });
    for (const [index, email] of LEGACY_DEMO_EMAILS.entries()) {
      const role = (["ADMIN", "REQUESTER", "ATTENDANT", "MANAGER"] as const)[index]!;
      await prisma.user.create({
        data: {
          name: `Conta genérica ${index}`,
          email,
          role,
          sectorId: role === "ATTENDANT" || role === "MANAGER" ? legacySector.id : null,
          passwordHash: "!demo",
        },
      });
    }

    await ensureDemoDataLoaded(prisma, now);

    await expect(prisma.user.count({ where: { email: { in: [...LEGACY_DEMO_EMAILS] }, isActive: true } })).resolves.toBe(0);
    await expect(prisma.sector.findMany({ select: { id: true, name: true } })).resolves.toEqual([
      { id: legacySector.id, name: DEMO_SECTOR_NAME },
    ]);
  });

  // Defect found on the published site (2026-11-02): it had the data of the seed of 2026-10-30
  // (requests of Ana, Bruno and Carla, no approvals) and the first click loaded nothing.
  it("loads the current set over the data of the previous seed", async () => {
    const legacySector = await prisma.sector.create({ data: { name: LEGACY_DEMO_SECTOR_NAME } });
    const legacyAdmin = await prisma.user.create({
      data: { name: "Administrador (demonstração)", email: LEGACY_DEMO_EMAILS[0]!, role: "ADMIN", passwordHash: "!demo" },
    });
    const ana = await prisma.user.create({
      data: { name: "Ana Souza", email: DEMO_ACCOUNTS.REQUESTER.email, role: "REQUESTER", passwordHash: "!demo" },
    });
    const category = await prisma.category.create({ data: { name: "TI" } });
    const service = await prisma.service.create({
      data: { name: "Criação de conta de acesso", description: "Antiga", categoryId: category.id, sectorId: legacySector.id },
    });
    const old = await createDomainRequest({ requesterId: ana.id, serviceId: service.id, sectorId: legacySector.id });

    await expect(ensureDemoDataLoaded(prisma, now)).resolves.toMatchObject({ requestsCreated: DEMO_REQUESTS.length });

    await expect(prisma.request.count()).resolves.toBe(DEMO_REQUESTS.length + 1);
    await expect(prisma.request.findUniqueOrThrow({ where: { id: old.id } })).resolves.toMatchObject({
      description: old.description,
      sectorNameSnapshot: LEGACY_DEMO_SECTOR_NAME,
    });
    await expect(prisma.user.findUniqueOrThrow({ where: { id: legacyAdmin.id } })).resolves.toMatchObject({ isActive: false });
    await expect(prisma.sector.findUniqueOrThrow({ where: { id: legacySector.id } })).resolves.toMatchObject({
      name: DEMO_SECTOR_NAME,
    });
    await expect(ensureDemoDataLoaded(prisma, now)).resolves.toBeNull();
  });

  it("signs each button in as its fictitious person, without duplicating anyone", async () => {
    await seedDemoData(prisma, now);

    for (const role of DEMO_ROLES) {
      const person = await signInAsDemoUser({ role }, prisma);
      expect(person).toMatchObject({ name: DEMO_ACCOUNTS[role].name, email: DEMO_ACCOUNTS[role].email });
    }

    await expect(prisma.user.count()).resolves.toBe(6);
    const ana = await prisma.user.findUniqueOrThrow({ where: { email: DEMO_ACCOUNTS.REQUESTER.email } });
    await expect(prisma.request.count({ where: { requesterId: ana.id } })).resolves.toBeGreaterThan(0);
    for (const role of ["ATTENDANT", "MANAGER"] as const) {
      const person = await prisma.user.findUniqueOrThrow({
        where: { email: DEMO_ACCOUNTS[role].email },
        select: { sector: { select: { name: true } } },
      });
      expect(person.sector?.name).toBe(DEMO_SECTOR_NAME);
    }
  });

  it("creates no usable passwords", async () => {
    await seedDemoData(prisma, now);

    for (const email of [...Object.values(DEMO_ACCOUNTS).map(({ email }) => email), "bruno.lima@exemplo.test"]) {
      await expect(authenticateCredentials({ email, password: "senha" }, prisma)).resolves.toBeNull();
    }
  });
});
