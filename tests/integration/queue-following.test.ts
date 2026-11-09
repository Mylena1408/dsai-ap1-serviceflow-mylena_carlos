import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { ValidationError } from "@/server/errors";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { addFollower, listFollowedElsewhere } from "@/modules/followers";
import { searchAttendantQueue, searchRequesterRequests } from "@/modules/requests";
import { parseSearchCriteria } from "@/modules/requests/domain/search-criteria";

// SPEC 2026-11-08-atendimento-dia-a-dia, 13.3 item 1 (SF-229; part of CA-SEG-06; decision J6).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });

describe("\"Que eu acompanho\" in the queue (13.3 item 1)", () => {
  it("the filter is the queue's only, \"1\" or absent", () => {
    expect(parseSearchCriteria({ following: "1" }, "attendant").following).toBe(true);
    expect(parseSearchCriteria({}, "attendant").following).toBeUndefined();
    expect(parseSearchCriteria({ following: "1" }, "requester").following).toBeUndefined();
    expect(() => parseSearchCriteria({ following: "sim" }, "attendant")).toThrow(ValidationError);
  });

  it("shows only the sector's requests the attendant follows; the ones moved away are listed apart", async () => {
    const ti = await createDomainSector();
    const rh = await createDomainSector();
    const category = await createDomainCategory();
    const service = await createDomainService({ categoryId: category.id, sectorId: ti.id });
    const rita = await createDomainUser({ role: "REQUESTER" });
    const ana = await createDomainUser({ role: "ATTENDANT", sectorId: ti.id });
    const bia = await createDomainUser({ role: "ATTENDANT", sectorId: ti.id });
    const followed = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: ti.id });
    const other = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: ti.id });
    const moved = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: ti.id });

    actAs(ana);
    await addFollower({ requestId: followed.id });
    await addFollower({ requestId: moved.id });
    // Moved to another sector after Ana started following it.
    await prisma.request.update({ where: { id: moved.id }, data: { sectorId: rh.id } });

    const result = await searchAttendantQueue({ following: "1" });
    expect(result.items.map(({ id }) => id)).toEqual([followed.id]);
    expect((await searchAttendantQueue({})).items.map(({ id }) => id).sort()).toEqual([followed.id, other.id].sort());
    const elsewhere = await listFollowedElsewhere();
    expect(elsewhere).toEqual([{ requestId: moved.id, serviceName: expect.any(String), status: "OPEN", sectorName: expect.any(String) }]);

    // A colleague of the sector follows nothing: an empty filter, nothing elsewhere.
    actAs(bia);
    expect((await searchAttendantQueue({ following: "1" })).items).toEqual([]);
    expect(await listFollowedElsewhere()).toEqual([]);
    // The requester's list ignores the parameter.
    actAs(rita);
    expect((await searchRequesterRequests({ following: "1" })).items).toHaveLength(3);
    expect(await listFollowedElsewhere()).toEqual([]);
  });
});
