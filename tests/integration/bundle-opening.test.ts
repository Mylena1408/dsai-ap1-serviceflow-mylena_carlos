import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { ConflictError, NotFoundError } from "@/server/errors";
import { createDomainCategory, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-07-operacao-e-automacao, 3.3 items 2 and 3 (SF-178; CA-VNC-04 in the catalog and
// CA-VNC-05).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { openBundle } from "@/modules/requests";
import { FieldAnswersError } from "@/modules/service-fields";
import { createBundle, getCatalogBundle, listCatalogBundles } from "@/modules/service-bundles";

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });

async function scenario() {
  const ti = await createDomainSector();
  const facilities = await createDomainSector();
  const category = await createDomainCategory();
  const access = await createDomainService({ categoryId: category.id, sectorId: ti.id });
  const desk = await createDomainService({ categoryId: category.id, sectorId: facilities.id });
  await prisma.service.update({ where: { id: access.id }, data: { slaHours: 8 } });
  await prisma.service.update({ where: { id: desk.id }, data: { requiresApproval: true } });
  const system = await prisma.serviceField.create({
    data: { serviceId: access.id, label: "Sistema", type: "SELECT", isRequired: true, options: ["ERP", "CRM"], position: 1 },
  });
  const floor = await prisma.serviceField.create({
    data: { serviceId: desk.id, label: "Andar", type: "INTEGER", isRequired: true, options: [], minValue: 1, maxValue: 20, position: 1 },
  });
  const admin = await createDomainUser({ role: "ADMIN" });
  const rita = await createDomainUser({ role: "REQUESTER" });
  actAs(admin);
  const bundle = await createBundle({ name: "Admissão", serviceIds: [desk.id, access.id] }, prisma);
  actAs(rita);
  return { ti, facilities, access, desk, system, floor, admin, rita, bundle };
}

describe("bundles in the catalog (3.3 item 2; CA-VNC-04)", () => {
  it("shows a bundle only while every service can be opened", async () => {
    const { bundle, desk, access } = await scenario();
    expect((await listCatalogBundles(prisma)).map(({ id }) => id)).toEqual([bundle.id]);
    expect((await getCatalogBundle(bundle.id, prisma)).services.map(({ id }) => id)).toEqual([desk.id, access.id]);

    await prisma.serviceDocumentRequirement.create({ data: { serviceId: access.id, name: "Termo", isRequired: false, acceptedFormats: ["PDF"], position: 1 } });
    await expect(listCatalogBundles(prisma)).resolves.toEqual([]);
    await expect(getCatalogBundle(bundle.id, prisma)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("opening a bundle (3.3 item 3; CA-VNC-05)", () => {
  it("creates one request per service in one transaction, each as if opened alone", async () => {
    const { bundle, access, desk, system, floor, rita } = await scenario();
    const opened = await openBundle(
      { bundleId: bundle.id, description: "Novo colaborador na segunda", fieldValues: { [system.id]: "ERP", [floor.id]: "7" } },
      prisma,
    );
    expect(opened.requestIds).toHaveLength(2);

    const group = await prisma.requestGroup.findUniqueOrThrow({ where: { id: opened.groupId }, include: { requests: true } });
    expect(group).toMatchObject({ bundleId: bundle.id, bundleNameSnapshot: "Admissão", requesterId: rita.id });
    const [deskRequest, accessRequest] = await Promise.all(opened.requestIds.map((id) => prisma.request.findUniqueOrThrow({ where: { id }, include: { fieldValues: true } })));

    // In the bundle's order; each with its own service, sector, approval and SLA.
    expect(deskRequest).toMatchObject({ serviceId: desk.id, groupId: group.id, description: "Novo colaborador na segunda", approvalState: "PENDING", dueAt: null });
    expect(accessRequest).toMatchObject({ serviceId: access.id, groupId: group.id, approvalState: null, slaHoursSnapshot: 8 });
    expect(accessRequest.dueAt).not.toBeNull();
    expect(deskRequest.fieldValues.map(({ fieldId, value }) => [fieldId, value])).toEqual([[floor.id, "7"]]);
    expect(accessRequest.fieldValues.map(({ fieldId, value }) => [fieldId, value])).toEqual([[system.id, "ERP"]]);
    // Each opening has its history and its "request.opened".
    await expect(prisma.requestStatusEvent.count({ where: { requestId: { in: opened.requestIds }, toStatus: "OPEN" } })).resolves.toBe(2);
    await expect(prisma.outboxEvent.count({ where: { requestId: { in: opened.requestIds }, type: "request.opened" } })).resolves.toBe(2);
  });

  it("opens nothing when any section is refused, with the errors of every section together", async () => {
    const { bundle, system, floor } = await scenario();
    const refused = await openBundle({ bundleId: bundle.id, description: "x", fieldValues: { [system.id]: "Outro", [floor.id]: "99" } }, prisma).catch(
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(FieldAnswersError);
    expect((refused as FieldAnswersError).fieldErrors.map(({ fieldId }) => fieldId).sort()).toEqual([floor.id, system.id].sort());

    // An answer to a field no service has: the form is stale.
    const stale = await openBundle({ bundleId: bundle.id, description: "x", fieldValues: { [system.id]: "ERP", [floor.id]: "3", unknown: "x" } }, prisma).catch(
      (error: unknown) => error,
    );
    expect((stale as FieldAnswersError).reason).toBe("stale_form");
    await expect(prisma.request.count()).resolves.toBe(0);
    await expect(prisma.requestGroup.count()).resolves.toBe(0);
  });

  it("refuses an unavailable bundle or service and a service that now asks for documents", async () => {
    const { bundle, access, desk, system, floor, admin, rita } = await scenario();
    const input = { bundleId: bundle.id, description: "x", fieldValues: { [system.id]: "ERP", [floor.id]: "3" } };

    await prisma.serviceDocumentRequirement.create({ data: { serviceId: desk.id, name: "Planta", isRequired: true, acceptedFormats: ["PDF"], position: 1 } });
    await expect(openBundle(input, prisma)).rejects.toBeInstanceOf(ConflictError);
    await prisma.serviceDocumentRequirement.updateMany({ where: { serviceId: desk.id }, data: { isActive: false } });

    await prisma.service.update({ where: { id: access.id }, data: { isActive: false } });
    await expect(openBundle(input, prisma)).rejects.toBeInstanceOf(NotFoundError);
    await prisma.service.update({ where: { id: access.id }, data: { isActive: true } });

    await prisma.serviceBundle.update({ where: { id: bundle.id }, data: { isActive: false } });
    await expect(openBundle(input, prisma)).rejects.toBeInstanceOf(NotFoundError);
    await prisma.serviceBundle.update({ where: { id: bundle.id }, data: { isActive: true } });

    // Only a requester opens.
    actAs(admin);
    await expect(openBundle(input, prisma)).rejects.toThrow();
    actAs(rita);
    await expect(openBundle(input, prisma)).resolves.toMatchObject({ requestIds: expect.any(Array) });
    await expect(prisma.request.count()).resolves.toBe(2);
  });
});
