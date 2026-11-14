import { describe, expect, it, vi } from "vitest";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});
const schedule = vi.hoisted(() => ({ scheduleEventProcessing: vi.fn() }));
vi.mock("@/server/jobs/schedule", () => schedule);

import { generateApiToken } from "@/modules/api-tokens";
import { getRequest, getRequests, postAssume } from "@/modules/public-api";

// SPEC 2026-11-08-atendimento-dia-a-dia, 9.1 item 2 (SF-221; decision I20; CA-CMP-02): the detail carries the
// tags, the checklist and the minutes logged for the team of the sector (attendants and its manager), and null
// in each for anyone else who reads the request. The session is not mocked: the API reads the caller from the token.

type TeamFields = {
  tags: Array<{ id: string; name: string; color: string; active: boolean; fromOtherSector: boolean }> | null;
  checklist: {
    done: number;
    total: number;
    items: Array<{ text: string; required: boolean; done: boolean; doneAt: string | null; doneBy: { id: string; name: string } | null }>;
  } | null;
  minutesLogged: number | null;
};

const params = (requestId: string) => ({ params: Promise.resolve({ requestId }) });

async function tokenFor(userId: string, scope: "READ" | "WRITE" = "READ") {
  const token = generateApiToken();
  const now = new Date();
  await prisma.apiToken.create({
    data: { userId, name: "team", scope, tokenHash: token.hash, lastFour: token.lastFour, createdAt: now, expiresAt: new Date(now.getTime() + 86_400_000) },
  });
  return { authorization: `Bearer ${token.value}`, "content-type": "application/json" };
}

async function detail(requestId: string, userId: string) {
  const response = await getRequest(new Request(`https://serviceflow.test/api/v1/requests/${requestId}`, { headers: await tokenFor(userId) }), params(requestId));
  return { status: response.status, body: (await response.json()) as TeamFields & Record<string, unknown> };
}

/** A sector with its attendant and manager, a service and a requester. */
async function setting() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const attendant = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const manager = await createDomainUser({ role: "MANAGER", sectorId: sector.id });
  // The manager reads the sector's requests with "Ver todas as solicitações do setor", as on the screen.
  const admin = await createDomainUser({ role: "ADMIN" });
  await prisma.userPermission.create({ data: { userId: manager.id, permission: "SECTOR_REQUESTS_READ", grantedById: admin.id, grantedAt: new Date() } });
  const requester = await createDomainUser({ role: "REQUESTER" });
  return { sector, service, attendant, manager, requester };
}

describe("tags, checklist and minutes in the API detail (SF-221)", () => {
  it("the attendant and the manager of the sector read them as the screens' blocks; the requester gets null", async () => {
    const { sector, service, attendant, manager, requester } = await setting();
    const former = await createDomainSector();
    const request = await createDomainRequest({ requesterId: requester.id, serviceId: service.id, sectorId: sector.id, status: "IN_PROGRESS" });
    const now = new Date();

    // Written directly: tagging, copying the checklist and logging time have their own tests.
    const urgent = await prisma.sectorTag.create({ data: { sectorId: sector.id, name: "Urgente", color: "red" } });
    const network = await prisma.sectorTag.create({ data: { sectorId: former.id, name: "Rede", color: "blue" } });
    for (const tag of [urgent, network]) {
      await prisma.requestTag.create({ data: { requestId: request.id, tagId: tag.id, addedById: attendant.id, addedAt: now } });
    }
    await prisma.requestChecklist.create({ data: { requestId: request.id, copiedAt: now } });
    const doneAt = new Date("2026-11-14T12:00:00.000Z");
    await prisma.requestChecklistItem.create({
      data: { requestId: request.id, textSnapshot: "Conferir backup", isRequired: true, position: 1, doneAt, doneById: attendant.id, note: "feito" },
    });
    await prisma.requestChecklistItem.create({ data: { requestId: request.id, textSnapshot: "Avisar o usuário", isRequired: false, position: 2 } });
    const day = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
    await prisma.requestTimeEntry.create({ data: { requestId: request.id, userId: attendant.id, workedOn: day, minutes: 90 } });
    await prisma.requestTimeEntry.create({ data: { requestId: request.id, userId: attendant.id, workedOn: day, minutes: 45 } });
    // A removed entry does not count.
    await prisma.requestTimeEntry.create({ data: { requestId: request.id, userId: attendant.id, workedOn: day, minutes: 600, deletedAt: now } });

    const expected = {
      tags: expect.arrayContaining([
        { id: urgent.id, name: "Urgente", color: "red", active: true, fromOtherSector: false },
        { id: network.id, name: "Rede", color: "blue", active: true, fromOtherSector: true },
      ]),
      checklist: {
        done: 1,
        total: 2,
        items: [
          { id: expect.any(String), text: "Conferir backup", required: true, done: true, doneAt: doneAt.toISOString(), doneBy: { id: attendant.id, name: attendant.name } },
          { id: expect.any(String), text: "Avisar o usuário", required: false, done: false, doneAt: null, doneBy: null },
        ],
      },
      minutesLogged: 135,
    };

    const asAttendant = await detail(request.id, attendant.id);
    expect(asAttendant.status).toBe(200);
    expect(asAttendant.body).toMatchObject(expected);
    expect(asAttendant.body.tags).toHaveLength(2);

    const asManager = await detail(request.id, manager.id);
    expect(asManager.status).toBe(200);
    expect(asManager.body).toMatchObject(expected);

    const asRequester = await detail(request.id, requester.id);
    expect(asRequester.status).toBe(200);
    expect(asRequester.body).toMatchObject({ tags: null, checklist: null, minutesLogged: null });
    // Nothing of the team's blocks leaks elsewhere in the requester's answer.
    expect(JSON.stringify(asRequester.body)).not.toContain("Urgente");
    expect(JSON.stringify(asRequester.body)).not.toContain("Conferir backup");
  });

  it("the manager who only decides an approval of another sector reads the request, but gets null in the three", async () => {
    const { sector, service, attendant, requester } = await setting();
    const finance = await createDomainSector();
    const approver = await createDomainUser({ role: "MANAGER", sectorId: finance.id });
    const request = await createDomainRequest({ requesterId: requester.id, serviceId: service.id, sectorId: sector.id });
    await prisma.request.update({
      where: { id: request.id },
      data: { approvalState: "PENDING", approvalLevel: 2, approvalSectorIdsSnapshot: [sector.id, finance.id], approvalPendingSectorId: finance.id },
    });
    const tag = await prisma.sectorTag.create({ data: { sectorId: sector.id, name: "Compras", color: "green" } });
    await prisma.requestTag.create({ data: { requestId: request.id, tagId: tag.id, addedById: attendant.id, addedAt: new Date() } });

    const asApprover = await detail(request.id, approver.id);
    expect(asApprover.status).toBe(200);
    expect(asApprover.body).toMatchObject({ id: request.id, tags: null, checklist: null, minutesLogged: null });

    // The sector's attendant still sees the tag.
    expect((await detail(request.id, attendant.id)).body.tags).toEqual([{ id: tag.id, name: "Compras", color: "green", active: true, fromOtherSector: false }]);
  });

  it("the team reading a request without tags, checklist or time gets an empty list, null and zero", async () => {
    const { sector, service, attendant, requester } = await setting();
    const request = await createDomainRequest({ requesterId: requester.id, serviceId: service.id, sectorId: sector.id });
    const response = await detail(request.id, attendant.id);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ tags: [], checklist: null, minutesLogged: 0 });
  });

  it("a checklist copied from an empty model is null, as the screen shows no block", async () => {
    const { sector, service, attendant, requester } = await setting();
    const request = await createDomainRequest({ requesterId: requester.id, serviceId: service.id, sectorId: sector.id, status: "IN_PROGRESS" });
    await prisma.requestChecklist.create({ data: { requestId: request.id, copiedAt: new Date() } });
    expect((await detail(request.id, attendant.id)).body.checklist).toBeNull();
  });

  it("an action answers the same detail, with the team's fields", async () => {
    const { sector, service, attendant, requester } = await setting();
    const request = await createDomainRequest({ requesterId: requester.id, serviceId: service.id, sectorId: sector.id });
    const tag = await prisma.sectorTag.create({ data: { sectorId: sector.id, name: "Rede", color: "blue" } });
    await prisma.requestTag.create({ data: { requestId: request.id, tagId: tag.id, addedById: attendant.id, addedAt: new Date() } });

    const response = await postAssume(
      new Request(`https://serviceflow.test/api/v1/requests/${request.id}/assume`, { method: "POST", headers: await tokenFor(attendant.id, "WRITE") }),
      params(request.id),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ assignee: { id: attendant.id }, tags: [{ name: "Rede" }], checklist: null, minutesLogged: 0 });
  });

  it("the listing does not change: its items carry none of the three", async () => {
    const { sector, service, attendant, requester } = await setting();
    await createDomainRequest({ requesterId: requester.id, serviceId: service.id, sectorId: sector.id });
    const response = await getRequests(new Request("https://serviceflow.test/api/v1/requests", { headers: await tokenFor(attendant.id) }));
    expect(response.status).toBe(200);
    const page = (await response.json()) as { items: Array<Record<string, unknown>> };
    expect(page.items.length).toBeGreaterThan(0);
    for (const item of page.items) {
      expect(item).not.toHaveProperty("tags");
      expect(item).not.toHaveProperty("checklist");
      expect(item).not.toHaveProperty("minutesLogged");
    }
  });
});
