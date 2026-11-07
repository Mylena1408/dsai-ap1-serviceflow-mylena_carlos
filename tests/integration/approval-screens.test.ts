import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./fixtures";
import { AuthorizationError } from "@/server/errors";
import { createDomainCategory, createDomainSector, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { grantPermission } from "@/modules/permissions";
import { listApprovalSectorChoices } from "@/modules/sectors";
import { configureServiceApproval, createService } from "@/modules/services";
import { createRequest, decideApproval, getApprovalLevels, getRequesterRequest } from "@/modules/requests";

// SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3 on the screens' data (SF-167; CA-APM-02 and 07).

function actAs(user: User) {
  session.getCurrentUser.mockResolvedValue({ id: user.id, name: user.name, email: user.email, role: user.role, sectorId: user.sectorId, isActive: user.isActive });
}

describe("approval data of the screens (SF-167)", () => {
  it("lets a sector catalog editor choose any active sector as a level (decision G19)", async () => {
    const purchasing = await createDomainSector();
    const finance = await createDomainSector();
    const closed = await createDomainSector(false);
    const category = await createDomainCategory();
    const admin = await createDomainUser({ role: "ADMIN" });
    const ana = await createDomainUser({ role: "ATTENDANT", sectorId: purchasing.id });
    const rita = await createDomainUser({ role: "REQUESTER" });
    actAs(admin);
    await grantPermission({ userId: ana.id, permission: "SECTOR_SERVICES" }, prisma);

    actAs(ana);
    const choices = await listApprovalSectorChoices(prisma);
    expect(choices.map(({ id }) => id)).toEqual(expect.arrayContaining([purchasing.id, finance.id]));
    expect(choices.some(({ id }) => id === closed.id)).toBe(false);
    expect(Object.keys(choices[0]!).sort()).toEqual(["id", "name"]);

    const service = await createService(
      { name: `Compra ${purchasing.id}`, description: "Compra", categoryId: category.id, sectorId: purchasing.id, requiresApproval: true },
      prisma,
    );
    await expect(
      configureServiceApproval(service.id, { sectorIds: [purchasing.id, finance.id], conditionFieldId: null, conditionValue: null, deadlineDays: 3 }, prisma),
    ).resolves.toMatchObject({ approvalSectorIds: [purchasing.id, finance.id], approvalDeadlineDays: 3 });

    actAs(rita);
    await expect(listApprovalSectorChoices(prisma)).rejects.toThrow(AuthorizationError);
  });

  it("names the levels of a request for the screens, with the decisions", async () => {
    const purchasing = await createDomainSector();
    const finance = await createDomainSector();
    const category = await createDomainCategory();
    const admin = await createDomainUser({ role: "ADMIN" });
    const rita = await createDomainUser({ role: "REQUESTER" });
    const gabi = await createDomainUser({ role: "MANAGER", sectorId: purchasing.id });
    actAs(admin);
    const service = await createService(
      { name: `Compra ${purchasing.id}`, description: "Compra", categoryId: category.id, sectorId: purchasing.id, requiresApproval: true },
      prisma,
    );
    await configureServiceApproval(service.id, { sectorIds: [purchasing.id, finance.id], conditionFieldId: null, conditionValue: null, deadlineDays: 2 }, prisma);
    actAs(rita);
    const { id } = await createRequest({ serviceId: service.id, description: "Notebook" }, prisma);
    actAs(gabi);
    await decideApproval({ requestId: id, decision: "APPROVED", note: "Ok" }, prisma);

    actAs(rita);
    const request = await getRequesterRequest(id, prisma);
    const view = await getApprovalLevels(request, prisma);
    const purchasingName = (await prisma.sector.findUniqueOrThrow({ where: { id: purchasing.id } })).name;
    const financeName = (await prisma.sector.findUniqueOrThrow({ where: { id: finance.id } })).name;
    expect(view).toMatchObject({
      levelCount: 2,
      lines: [
        { level: 1, sectorName: purchasingName, situation: "approved", decider: gabi.name, note: "Ok" },
        { level: 2, sectorName: financeName, situation: "pending", overdue: false },
      ],
    });
    expect(view!.lines[1]!.dueAt).not.toBeNull();
  });
});
