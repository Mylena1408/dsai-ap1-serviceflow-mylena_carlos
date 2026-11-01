import { describe, expect, it, vi } from "vitest";
import type { Role, User } from "@prisma/client";
import { prisma } from "./fixtures";
import { AuthenticationError, AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { createDomainCategory, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-01-fluxos-configuraveis, section 5.1 (SF-077; CA-FLX-02 and 03).

const session = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import {
  createServiceStage,
  deactivateServiceStage,
  listServiceStages,
  moveServiceStage,
  reactivateServiceStage,
  renameServiceStage,
} from "@/modules/service-stages";

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

async function actAs(role: Role) {
  const sector = role === "ATTENDANT" ? await createDomainSector() : null;
  const user = await createDomainUser({ role, sectorId: sector?.id });
  setSessionActor(user);
  return user;
}

async function createServiceContext() {
  const category = await createDomainCategory();
  const sector = await createDomainSector();
  return createDomainService({ categoryId: category.id, sectorId: sector.id });
}

async function activeOrder(serviceId: string): Promise<string[]> {
  const stages = await prisma.serviceStage.findMany({
    where: { serviceId, isActive: true },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { name: true },
  });
  return stages.map(({ name }) => name);
}

describe("stage configuration (SF-077)", () => {
  it("lets an administrator build, reorder, rename and reactivate a flow (CA-FLX-02)", async () => {
    await actAs("ADMIN");
    const service = await createServiceContext();
    const [triage, , tests] = [
      await createServiceStage(service.id, { name: " Triagem " }, prisma),
      await createServiceStage(service.id, { name: "Execução" }, prisma),
      await createServiceStage(service.id, { name: "Testes" }, prisma),
    ];
    expect(triage).toMatchObject({ serviceId: service.id, name: "Triagem", position: 0, isActive: true });

    await moveServiceStage(tests.id, "up", prisma);
    expect(await activeOrder(service.id)).toEqual(["Triagem", "Testes", "Execução"]);

    await renameServiceStage(triage.id, { name: "Análise" }, prisma);
    await deactivateServiceStage(triage.id, prisma);
    expect(await activeOrder(service.id)).toEqual(["Testes", "Execução"]);
    await expect(renameServiceStage(triage.id, { name: "Outra" }, prisma)).rejects.toBeInstanceOf(ConflictError);

    await reactivateServiceStage(triage.id, prisma);
    expect(await activeOrder(service.id)).toEqual(["Testes", "Execução", "Análise"]);
    await expect(listServiceStages(prisma)).resolves.toHaveLength(3);
  });

  it("refuses repeated names among the active stages, ignoring case (CA-FLX-03)", async () => {
    await actAs("ADMIN");
    const service = await createServiceContext();
    const other = await createServiceContext();
    const triage = await createServiceStage(service.id, { name: "Triagem" }, prisma);
    const execution = await createServiceStage(service.id, { name: "Execução" }, prisma);

    await expect(createServiceStage(service.id, { name: "TRIAGEM" }, prisma)).rejects.toBeInstanceOf(ConflictError);
    await expect(renameServiceStage(execution.id, { name: "triagem" }, prisma)).rejects.toBeInstanceOf(ConflictError);
    await expect(createServiceStage(other.id, { name: "Triagem" }, prisma)).resolves.toBeTruthy();

    await deactivateServiceStage(triage.id, prisma);
    await createServiceStage(service.id, { name: "TRIAGEM" }, prisma);
    await expect(reactivateServiceStage(triage.id, prisma)).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses the ninth active stage, also on reactivation, and invalid names (CA-FLX-03)", async () => {
    await actAs("ADMIN");
    const service = await createServiceContext();
    const spare = await createServiceStage(service.id, { name: "Reserva" }, prisma);
    await deactivateServiceStage(spare.id, prisma);
    for (let index = 1; index <= 8; index += 1) {
      await createServiceStage(service.id, { name: `Etapa ${index}` }, prisma);
    }

    await expect(createServiceStage(service.id, { name: "Etapa 9" }, prisma)).rejects.toBeInstanceOf(ConflictError);
    await expect(reactivateServiceStage(spare.id, prisma)).rejects.toBeInstanceOf(ConflictError);

    const empty = await createServiceContext();
    for (const name of ["", "   ", "a".repeat(61)]) {
      await expect(createServiceStage(empty.id, { name }, prisma)).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(prisma.serviceStage.count({ where: { serviceId: empty.id } })).resolves.toBe(0);
    await expect(createServiceStage(crypto.randomUUID(), { name: "X" }, prisma)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("denies every operation to requesters, attendants and anonymous users (CA-FLX-02)", async () => {
    await actAs("ADMIN");
    const service = await createServiceContext();
    const stage = await createServiceStage(service.id, { name: "Triagem" }, prisma);

    for (const role of ["REQUESTER", "ATTENDANT"] as const) {
      await actAs(role);
      await expect(listServiceStages(prisma)).rejects.toBeInstanceOf(AuthorizationError);
      await expect(createServiceStage(service.id, { name: "B" }, prisma)).rejects.toBeInstanceOf(AuthorizationError);
      await expect(renameServiceStage(stage.id, { name: "B" }, prisma)).rejects.toBeInstanceOf(AuthorizationError);
      await expect(moveServiceStage(stage.id, "down", prisma)).rejects.toBeInstanceOf(AuthorizationError);
      await expect(deactivateServiceStage(stage.id, prisma)).rejects.toBeInstanceOf(AuthorizationError);
      await expect(reactivateServiceStage(stage.id, prisma)).rejects.toBeInstanceOf(AuthorizationError);
    }

    setSessionActor(null);
    await expect(createServiceStage(service.id, { name: "B" }, prisma)).rejects.toBeInstanceOf(AuthenticationError);
    await expect(prisma.serviceStage.findMany({ where: { serviceId: service.id } })).resolves.toMatchObject([
      { name: "Triagem", isActive: true },
    ]);
  });
});
