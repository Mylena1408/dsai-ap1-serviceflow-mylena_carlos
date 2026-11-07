import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { ValidationError } from "@/server/errors";
import { createDomainCategory, createDomainSector, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { grantPermission } from "@/modules/permissions";
import { createServiceStage, listStageAssigneeChoices } from "@/modules/service-stages";
import { createService } from "@/modules/services";
import {
  assumeRequest,
  createRequest,
  listQueueStageChoices,
  moveRequestStage,
  searchAttendantQueue,
  searchRequesterRequests,
  transitionRequestStatus,
} from "@/modules/requests";

// SPEC 2026-11-06-aprofundamento-configurabilidade, 5.3.4 (SF-170; CA-ETP-06) and the choices of the
// stage settings screen (CA-ETP-02).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };

function actAs(actor: Actor) {
  session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
}

async function scenario() {
  const sector = await createDomainSector();
  const otherSector = await createDomainSector();
  const category = await createDomainCategory();
  const admin = await createDomainUser({ role: "ADMIN" });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const caio = await createDomainUser({ role: "ATTENDANT", sectorId: otherSector.id });
  actAs(admin);
  const service = await createService({ name: `Reparo ${sector.id}`, description: "Reparo", categoryId: category.id, sectorId: sector.id }, prisma);
  const plain = await createService({ name: `Mouse ${sector.id}`, description: "Mouse", categoryId: category.id, sectorId: sector.id }, prisma);
  for (const name of ["Triagem", "Bancada"]) await createServiceStage(service.id, { name }, prisma);

  actAs(rita);
  const open = async (serviceId: string, description: string) => (await createRequest({ serviceId, description }, prisma)).id;
  const ids = {
    triage: await open(service.id, "Na triagem"),
    bench: await open(service.id, "Na bancada"),
    noFlow: await open(plain.id, "Sem fluxo"),
    waiting: await open(service.id, "Ainda aberta"),
  };
  actAs(ana);
  for (const id of [ids.triage, ids.bench, ids.noFlow]) {
    await assumeRequest({ requestId: id }, prisma);
    await transitionRequestStatus({ requestId: id, toStatus: "IN_PROGRESS" }, prisma);
  }
  await moveRequestStage({ requestId: ids.bench, direction: "advance", fromStageIndex: 0 }, prisma);
  return { sector, admin, rita, ana, caio, ids };
}

const descriptions = (result: { items: Array<{ description: string }> }) => result.items.map(({ description }) => description).sort();

describe("queue filter by stage (SF-170)", () => {
  it("keeps the current stage name in the generated column, following the moves", async () => {
    const { ids } = await scenario();
    const row = (id: string) => prisma.request.findUniqueOrThrow({ where: { id }, select: { currentStageName: true } });
    await expect(row(ids.triage)).resolves.toEqual({ currentStageName: "Triagem" });
    await expect(row(ids.bench)).resolves.toEqual({ currentStageName: "Bancada" });
    await expect(row(ids.noFlow)).resolves.toEqual({ currentStageName: null });
    await expect(row(ids.waiting)).resolves.toEqual({ currentStageName: null });
  });

  it("filters the queue by the current stage or by 'Sem etapa', with the other criteria (CA-ETP-06)", async () => {
    const { ana } = await scenario();
    actAs(ana);
    expect(descriptions(await searchAttendantQueue({ stage: "Bancada" }, prisma))).toEqual(["Na bancada"]);
    expect(descriptions(await searchAttendantQueue({ stage: "Triagem" }, prisma))).toEqual(["Na triagem"]);
    expect(descriptions(await searchAttendantQueue({ stage: "__none__" }, prisma))).toEqual(["Ainda aberta", "Sem fluxo"]);
    expect(descriptions(await searchAttendantQueue({ stage: "__none__", status: "IN_PROGRESS" }, prisma))).toEqual(["Sem fluxo"]);
    expect(descriptions(await searchAttendantQueue({ stage: "Bancada", q: "triagem" }, prisma))).toEqual([]);
    expect(descriptions(await searchAttendantQueue({ stage: "" }, prisma))).toHaveLength(4);
    await expect(searchAttendantQueue({ stage: "x".repeat(61) }, prisma)).rejects.toThrow(ValidationError);
  });

  it("lists the current stages of the sector's requests in progress, and ignores the filter for requesters", async () => {
    const { ana, caio, rita } = await scenario();
    actAs(ana);
    await expect(listQueueStageChoices(prisma)).resolves.toEqual(["Bancada", "Triagem"]);
    actAs(caio);
    await expect(listQueueStageChoices(prisma)).resolves.toEqual([]);
    actAs(rita);
    await expect(listQueueStageChoices(prisma)).rejects.toThrow();
    expect(descriptions(await searchRequesterRequests({ stage: "Bancada" }, prisma))).toHaveLength(4);
  });
});

describe("choices of the stage's attendant (SF-170)", () => {
  it("gives the administrator every active attendant and a sector editor only the own sector's", async () => {
    const { sector, admin, ana, caio } = await scenario();
    await createDomainUser({ role: "ATTENDANT", sectorId: sector.id, isActive: false });
    actAs(admin);
    const all = await listStageAssigneeChoices(prisma);
    expect(all.map(({ id }) => id)).toEqual(expect.arrayContaining([ana.id, caio.id]));
    expect(all.find(({ id }) => id === ana.id)).toEqual({ id: ana.id, name: ana.name, sectorId: sector.id });

    await grantPermission({ userId: ana.id, permission: "SECTOR_SERVICES" }, prisma);
    actAs(ana);
    const own = await listStageAssigneeChoices(prisma);
    expect(own.every(({ sectorId }) => sectorId === sector.id)).toBe(true);
    expect(own.map(({ id }) => id)).toEqual([ana.id]);
  });
});
