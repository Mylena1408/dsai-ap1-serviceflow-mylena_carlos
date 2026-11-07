import { describe, expect, it, vi } from "vitest";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainSector, createDomainUser } from "./domain-fixtures";

vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});
const schedule = vi.hoisted(() => ({ scheduleEventProcessing: vi.fn() }));
vi.mock("@/server/jobs/schedule", () => schedule);

import { generateApiToken } from "@/modules/api-tokens";
import { getRequest, getServices, postRequest } from "@/modules/public-api";

// SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3 through the API (SF-167; CA-APM-07). The
// session is not mocked here: the API reads the caller from the token.

const params = (requestId: string) => ({ params: Promise.resolve({ requestId }) });

async function tokenFor(userId: string, scope: "READ" | "WRITE" = "WRITE") {
  const token = generateApiToken();
  const now = new Date();
  await prisma.apiToken.create({
    data: { userId, name: "api", scope, tokenHash: token.hash, lastFour: token.lastFour, createdAt: now, expiresAt: new Date(now.getTime() + 86_400_000) },
  });
  return { authorization: `Bearer ${token.value}`, "content-type": "application/json" };
}

describe("approval levels through the API (SF-167)", () => {
  it("describes the service's approval and a request's progress and decisions, with the substitution", async () => {
    const purchasing = await createDomainSector();
    const finance = await createDomainSector();
    const category = await createDomainCategory();
    const rita = await createDomainUser({ role: "REQUESTER" });
    const gabi = await createDomainUser({ role: "MANAGER", sectorId: purchasing.id });
    const paulo = await createDomainUser({ role: "MANAGER", sectorId: finance.id });
    const service = await prisma.service.create({
      data: {
        name: "Compra",
        description: "Compra",
        categoryId: category.id,
        sectorId: purchasing.id,
        requiresApproval: true,
        approvalSectorIds: [purchasing.id, finance.id],
        approvalDeadlineDays: 2,
      },
    });
    const headers = await tokenFor(rita.id);

    const catalog = await getServices(new Request("https://serviceflow.test/api/v1/services?pageSize=100", { headers }));
    const items = (await catalog.json()).items as Array<{ id: string; approval: unknown }>;
    expect(items.find(({ id }) => id === service.id)!.approval).toEqual({
      levelSectorIds: [purchasing.id, finance.id],
      deadlineDays: 2,
      condition: null,
    });

    const created = await postRequest(
      new Request("https://serviceflow.test/api/v1/requests", { method: "POST", headers, body: JSON.stringify({ serviceId: service.id, description: "Notebook" }) }),
    );
    expect(created.status).toBe(201);
    const opened = await created.json();
    expect(opened.approvalProgress).toMatchObject({
      state: "PENDING",
      level: 1,
      levelCount: 2,
      levelSectorIds: [purchasing.id, finance.id],
      pendingSectorId: purchasing.id,
      overdue: false,
    });
    expect(opened.approvalProgress.dueAt).not.toBeNull();
    expect(opened.history.approvals).toEqual([]);

    // Level 1 decided by Paulo replacing Gabi (written directly: the decision flow has its own tests).
    await prisma.request.update({
      where: { id: opened.id },
      data: { approvalLevel: 2, approvalPendingSectorId: finance.id, approvalDueAt: new Date(Date.now() - 60_000) },
    });
    await prisma.requestApproval.create({
      data: { requestId: opened.id, level: 1, deciderId: paulo.id, onBehalfOfId: gabi.id, decision: "APPROVED", decidedAt: new Date("2026-11-06T10:00:00.000Z") },
    });

    const detail = await getRequest(new Request(`https://serviceflow.test/api/v1/requests/${opened.id}`, { headers }), params(opened.id));
    const body = await detail.json();
    expect(body.approvalProgress).toMatchObject({ level: 2, pendingSectorId: finance.id, overdue: true });
    expect(body.history.approvals).toEqual([
      {
        level: 1,
        decision: "APPROVED",
        decider: { id: paulo.id, name: paulo.name },
        onBehalfOf: { id: gabi.id, name: gabi.name },
        note: null,
        decidedAt: "2026-11-06T10:00:00.000Z",
      },
    ]);
    // The last decision stays where it was before levels.
    expect(body.history.approval).toMatchObject({ decision: "APPROVED", decider: { id: paulo.id } });
  });

  it("has no approval for services and requests without it", async () => {
    const sector = await createDomainSector();
    const category = await createDomainCategory();
    const rita = await createDomainUser({ role: "REQUESTER" });
    const service = await prisma.service.create({ data: { name: "Mouse", description: "Mouse", categoryId: category.id, sectorId: sector.id } });
    const headers = await tokenFor(rita.id);

    const catalog = await getServices(new Request("https://serviceflow.test/api/v1/services?pageSize=100", { headers }));
    const items = (await catalog.json()).items as Array<{ id: string; approval: unknown }>;
    expect(items.find(({ id }) => id === service.id)!.approval).toBeNull();
    const created = await postRequest(
      new Request("https://serviceflow.test/api/v1/requests", { method: "POST", headers, body: JSON.stringify({ serviceId: service.id, description: "Mouse" }) }),
    );
    const body = await created.json();
    expect(body.approvalProgress).toBeNull();
    expect(body.history.approvals).toEqual([]);
  });
});
