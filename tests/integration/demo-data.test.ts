import { describe, expect, it } from "vitest";
import { prisma } from "./fixtures";
import {
  DEMO_CATALOG,
  DEMO_DOCUMENT_REQUIREMENTS,
  DEMO_REQUESTS,
  seedDemoData,
} from "../../scripts/demo-data";
import { signInAsDemoUser } from "@/modules/auth/infrastructure/prisma-demo-accounts";
import { authenticateCredentials } from "@/modules/auth/infrastructure/prisma-credentials";
import { DEMO_ACCOUNTS, DEMO_SECTOR_NAME } from "@/modules/auth/domain/demo-accounts";

// SPEC 2026-09-30, sections 22.6 and 22.7 (CA-DEMO-07 and CA-DEMO-08).
describe("demonstration data", () => {
  const now = new Date("2026-10-30T12:00:00.000Z");
  const requirementCount = DEMO_DOCUMENT_REQUIREMENTS.flatMap(({ requirements }) => requirements).length;

  it("loads the catalog, people, requests and requirements once", async () => {
    const first = await seedDemoData(prisma, now);
    const second = await seedDemoData(prisma, now);

    expect(first).toEqual({
      categories: 3,
      services: 9,
      users: 7,
      requestsCreated: DEMO_REQUESTS.length,
      requirementsCreated: requirementCount,
    });
    expect(second).toMatchObject({ requestsCreated: 0, requirementsCreated: 0 });

    await expect(prisma.sector.count()).resolves.toBe(1);
    await expect(prisma.category.count()).resolves.toBe(DEMO_CATALOG.length);
    await expect(prisma.service.count()).resolves.toBe(9);
    await expect(prisma.user.count()).resolves.toBe(7);
    await expect(prisma.request.count()).resolves.toBe(DEMO_REQUESTS.length);
    await expect(prisma.serviceDocumentRequirement.count()).resolves.toBe(requirementCount);
  });

  it("puts every service in the demonstration sector and lists all statuses", async () => {
    await seedDemoData(prisma, now);

    const services = await prisma.service.findMany({ include: { sector: true } });
    expect(new Set(services.map(({ sector }) => sector.name))).toEqual(new Set([DEMO_SECTOR_NAME]));

    const statuses = await prisma.request.groupBy({ by: ["status"], _count: true });
    expect(statuses.map(({ status }) => status).sort()).toEqual(["COMPLETED", "IN_PROGRESS", "OPEN"]);
  });

  it("records a history consistent with each status", async () => {
    await seedDemoData(prisma, now);

    const requests = await prisma.request.findMany({
      include: { events: { orderBy: { occurredAt: "asc" } } },
    });
    const expectedSteps: Record<string, string[]> = { OPEN: ["OPEN"], IN_PROGRESS: ["OPEN", "IN_PROGRESS"], COMPLETED: ["OPEN", "IN_PROGRESS", "COMPLETED"] };

    for (const request of requests) {
      expect(request.events.map(({ toStatus }) => toStatus)).toEqual(expectedSteps[request.status]);
      expect(request.events[0]).toMatchObject({ fromStatus: null, actorId: request.requesterId });
      expect(request.completedAt !== null).toBe(request.status === "COMPLETED");
      expect(request.createdAt.getTime()).toBeLessThan(now.getTime());
      expect(request.updatedAt.getTime()).toBe(request.events.at(-1)?.occurredAt.getTime());
    }
  });

  it("works together with demonstration sign-in", async () => {
    await seedDemoData(prisma, now);

    const requester = await signInAsDemoUser({ role: "REQUESTER" }, prisma);
    const attendant = await signInAsDemoUser({ role: "ATTENDANT" }, prisma);

    await expect(prisma.user.count()).resolves.toBe(7);
    await expect(
      prisma.request.count({ where: { requesterId: requester?.id } }),
    ).resolves.toBeGreaterThan(0);
    const attendantSector = await prisma.user.findUniqueOrThrow({
      where: { id: attendant?.id },
      select: { sector: { select: { name: true } } },
    });
    expect(attendantSector.sector?.name).toBe(DEMO_SECTOR_NAME);
  });

  it("creates no usable passwords", async () => {
    await seedDemoData(prisma, now);

    for (const email of ["ana.souza@exemplo.test", DEMO_ACCOUNTS.ADMIN.email]) {
      await expect(authenticateCredentials({ email, password: "senha" }, prisma)).resolves.toBeNull();
    }
  });
});
