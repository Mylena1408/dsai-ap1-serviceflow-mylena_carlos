import {
  Prisma,
  type PrismaClient,
  type Request,
} from "@prisma/client";
import {
  assertRole,
  requireCurrentActor,
  requireRequestCreator,
  requireStatusChangeActor,
} from "@/server/authorization";
import { ConflictError, NotFoundError } from "@/server/errors";
import { prisma } from "@/server/db";
import {
  entityIdSchema,
  requestCreationInputSchema,
  requestStatusTransitionInputSchema,
} from "@/shared/validation";
import { validateInput } from "@/server/validation";
import { assertServiceCanReceiveRequests } from "@/modules/services";
import {
  assertRequestStatusTransition,
  buildRequestSnapshot,
} from "./policy";

export { buildRequestSnapshot } from "./policy";
export { assertRequestStatusTransition } from "./policy";

const requestWithHistory = {
  events: {
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    include: {
      actor: {
        select: { id: true, name: true, email: true },
      },
    },
  },
  service: {
    select: { id: true, isActive: true },
  },
} satisfies Prisma.RequestInclude;

export type RequestWithHistory = Prisma.RequestGetPayload<{
  include: typeof requestWithHistory;
}>;

export type CreatedRequest = RequestWithHistory;
export type RequestWithHistoryForRequester = RequestWithHistory;

export async function createRequest(
  input: unknown,
  database: PrismaClient = prisma,
): Promise<CreatedRequest> {
  const actor = await requireRequestCreator();
  const parsed = validateInput(requestCreationInputSchema, input);

  try {
    return await database.$transaction(
      async (transaction) => {
        const currentActor = await transaction.user.findUnique({
          where: { id: actor.id },
          select: { id: true, role: true, isActive: true },
        });

        if (
          !currentActor ||
          !currentActor.isActive ||
          currentActor.role !== "REQUESTER"
        ) {
          throw new NotFoundError();
        }

        const service = await transaction.service.findUnique({
          where: { id: parsed.serviceId },
          include: {
            category: { select: { id: true, name: true, isActive: true } },
            sector: { select: { id: true, name: true, isActive: true } },
          },
        });

        if (!service) {
          throw new NotFoundError();
        }

        assertServiceCanReceiveRequests({
          isActive: service.isActive,
          categoryActive: service.category.isActive,
          sectorActive: service.sector.isActive,
        });

        const created = await transaction.request.create({
          data: {
            ...buildRequestSnapshot(currentActor.id, service),
            description: parsed.description,
            status: "OPEN",
          },
          select: { id: true },
        });

        await transaction.requestStatusEvent.create({
          data: {
            requestId: created.id,
            actorId: currentActor.id,
            fromStatus: null,
            toStatus: "OPEN",
          },
        });

        return transaction.request.findUniqueOrThrow({
          where: { id: created.id },
          include: requestWithHistory,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ["P2003", "P2025"].includes(error.code)
    ) {
      throw new NotFoundError();
    }

    throw error instanceof Error ? error : new Error("Request creation failed.");
  }
}

export async function listRequesterRequests(
  database: PrismaClient = prisma,
): Promise<RequestWithHistoryForRequester[]> {
  const actor = assertRole(await requireCurrentActor(), "REQUESTER");

  return database.request.findMany({
    where: { requesterId: actor.id },
    include: requestWithHistory,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

export async function getRequesterRequest(
  requestId: unknown,
  database: PrismaClient = prisma,
): Promise<RequestWithHistoryForRequester> {
  const actor = assertRole(await requireCurrentActor(), "REQUESTER");
  const id = validateInput(entityIdSchema, requestId);
  const request = await database.request.findFirst({
    where: { id, requesterId: actor.id },
    include: requestWithHistory,
  });

  if (!request) {
    throw new NotFoundError();
  }

  return request;
}

export async function listAttendantQueue(
  database: PrismaClient = prisma,
): Promise<RequestWithHistory[]> {
  const actor = assertRole(await requireCurrentActor(), "ATTENDANT");

  if (!actor.sectorId) {
    throw new NotFoundError();
  }

  return database.request.findMany({
    where: { sectorId: actor.sectorId },
    include: requestWithHistory,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

export async function getAttendantRequest(
  requestId: unknown,
  database: PrismaClient = prisma,
): Promise<RequestWithHistory> {
  const actor = assertRole(await requireCurrentActor(), "ATTENDANT");
  const id = validateInput(entityIdSchema, requestId);

  if (!actor.sectorId) {
    throw new NotFoundError();
  }

  const request = await database.request.findFirst({
    where: { id, sectorId: actor.sectorId },
    include: requestWithHistory,
  });

  if (!request) {
    throw new NotFoundError();
  }

  return request;
}

export async function transitionRequestStatus(
  input: unknown,
  database: PrismaClient = prisma,
): Promise<RequestWithHistory> {
  const parsed = validateInput(requestStatusTransitionInputSchema, input);
  const authorizedActor = await requireStatusChangeActor(parsed.requestId);

  try {
    return await database.$transaction(
      async (transaction) => {
        const currentActor = await transaction.user.findUnique({
          where: { id: authorizedActor.actorId },
          select: { id: true, role: true, sectorId: true, isActive: true },
        });

        if (
          !currentActor?.isActive ||
          currentActor.role !== "ATTENDANT" ||
          currentActor.sectorId !== authorizedActor.sectorId
        ) {
          throw new NotFoundError();
        }

        const currentRequest = await transaction.request.findUnique({
          where: { id: parsed.requestId },
          select: { status: true, sectorId: true },
        });

        if (
          !currentRequest ||
          currentRequest.sectorId !== currentActor.sectorId
        ) {
          throw new NotFoundError();
        }

        assertRequestStatusTransition(currentRequest.status, parsed.toStatus);
        const now = new Date();
        const update = await transaction.request.updateMany({
          where: {
            id: parsed.requestId,
            sectorId: currentActor.sectorId,
            status: currentRequest.status,
          },
          data: {
            status: parsed.toStatus,
            updatedAt: now,
            ...(parsed.toStatus === "COMPLETED" ? { completedAt: now } : {}),
          },
        });

        if (update.count !== 1) {
          throw new ConflictError();
        }

        await transaction.requestStatusEvent.create({
          data: {
            requestId: parsed.requestId,
            actorId: currentActor.id,
            fromStatus: currentRequest.status,
            toStatus: parsed.toStatus,
            occurredAt: now,
          },
        });

        return transaction.request.findUniqueOrThrow({
          where: { id: parsed.requestId },
          include: requestWithHistory,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      throw new ConflictError();
    }

    throw error instanceof Error ? error : new Error("Request transition failed.");
  }
}

export type RequestSummary = Pick<
  Request,
  | "id"
  | "status"
  | "description"
  | "createdAt"
  | "updatedAt"
  | "completedAt"
  | "serviceNameSnapshot"
  | "serviceDescriptionSnapshot"
  | "categoryNameSnapshot"
  | "sectorNameSnapshot"
>;
