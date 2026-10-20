import {
  Prisma,
  type PrismaClient,
  type ServiceDocumentRequirement,
} from "@prisma/client";
import { requireConfigurationAdministrator } from "@/server/authorization";
import { ConflictError, NotFoundError } from "@/server/errors";
import { prisma } from "@/server/db";
import {
  documentRequirementInputSchema,
  documentRequirementMoveSchema,
  entityIdSchema,
} from "@/shared/validation";
import { validateInput } from "@/server/validation";
import {
  assertCanAddActiveRequirement,
  nextRequirementPosition,
  planRequirementMove,
} from "./policy";

export {
  MAX_ACTIVE_DOCUMENT_REQUIREMENTS,
  assertCanAddActiveRequirement,
  planRequirementMove,
} from "./policy";

// Administrative configuration of per-service document requirements (SPEC 21.2).
// Requirements are only deactivated logically; there is no reactivation or physical
// deletion. Changes affect future requests only: attachments keep their own snapshots.

export async function listDocumentRequirements(
  database: PrismaClient = prisma,
): Promise<ServiceDocumentRequirement[]> {
  await requireConfigurationAdministrator();

  return database.serviceDocumentRequirement.findMany({
    orderBy: [{ serviceId: "asc" }, { isActive: "desc" }, { position: "asc" }, { id: "asc" }],
  });
}

export async function createDocumentRequirement(
  serviceId: unknown,
  input: unknown,
  database: PrismaClient = prisma,
): Promise<ServiceDocumentRequirement> {
  await requireConfigurationAdministrator();
  const id = validateInput(entityIdSchema, serviceId);
  const parsed = validateInput(documentRequirementInputSchema, input);

  try {
    return await database.$transaction(
      async (transaction) => {
        const service = await transaction.service.findUnique({
          where: { id },
          select: { id: true },
        });

        if (!service) {
          throw new NotFoundError();
        }

        const existing = await transaction.serviceDocumentRequirement.findMany({
          where: { serviceId: id },
          select: { id: true, position: true, isActive: true },
        });
        assertCanAddActiveRequirement(existing.filter((requirement) => requirement.isActive).length);

        return transaction.serviceDocumentRequirement.create({
          data: {
            serviceId: id,
            name: parsed.name,
            isRequired: parsed.isRequired,
            acceptedFormats: parsed.acceptedFormats,
            position: nextRequirementPosition(existing),
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    throw mapRequirementPersistenceError(error);
  }
}

export async function updateDocumentRequirement(
  requirementId: unknown,
  input: unknown,
  database: PrismaClient = prisma,
): Promise<ServiceDocumentRequirement> {
  await requireConfigurationAdministrator();
  const id = validateInput(entityIdSchema, requirementId);
  const parsed = validateInput(documentRequirementInputSchema, input);

  try {
    return await database.$transaction(
      async (transaction) => {
        const current = await loadRequirement(transaction, id);

        // Inactive requirements are history only (no edit, move or reactivation).
        if (!current.isActive) {
          throw new ConflictError();
        }

        return transaction.serviceDocumentRequirement.update({
          where: { id },
          data: {
            name: parsed.name,
            isRequired: parsed.isRequired,
            acceptedFormats: parsed.acceptedFormats,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    throw mapRequirementPersistenceError(error);
  }
}

export async function moveDocumentRequirement(
  requirementId: unknown,
  direction: unknown,
  database: PrismaClient = prisma,
): Promise<void> {
  await requireConfigurationAdministrator();
  const id = validateInput(entityIdSchema, requirementId);
  const move = validateInput(documentRequirementMoveSchema, direction);

  try {
    await database.$transaction(
      async (transaction) => {
        const current = await loadRequirement(transaction, id);

        if (!current.isActive) {
          throw new ConflictError();
        }

        const activeRequirements = await transaction.serviceDocumentRequirement.findMany({
          where: { serviceId: current.serviceId, isActive: true },
          select: { id: true, position: true },
        });

        for (const update of planRequirementMove(activeRequirements, id, move)) {
          await transaction.serviceDocumentRequirement.update({
            where: { id: update.id },
            data: { position: update.position },
          });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    throw mapRequirementPersistenceError(error);
  }
}

export async function deactivateDocumentRequirement(
  requirementId: unknown,
  database: PrismaClient = prisma,
): Promise<ServiceDocumentRequirement> {
  await requireConfigurationAdministrator();
  const id = validateInput(entityIdSchema, requirementId);

  try {
    return await database.$transaction(
      async (transaction) => {
        const current = await loadRequirement(transaction, id);

        if (!current.isActive) {
          return current;
        }

        return transaction.serviceDocumentRequirement.update({
          where: { id },
          data: { isActive: false },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    throw mapRequirementPersistenceError(error);
  }
}

async function loadRequirement(
  transaction: Prisma.TransactionClient,
  id: string,
): Promise<ServiceDocumentRequirement> {
  const requirement = await transaction.serviceDocumentRequirement.findUnique({
    where: { id },
  });

  if (!requirement) {
    throw new NotFoundError();
  }

  return requirement;
}

function mapRequirementPersistenceError(error: unknown): Error {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return new ConflictError();
  }

  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2025" || error.code === "P2003")
  ) {
    return new NotFoundError();
  }

  return error instanceof Error ? error : new Error("Document requirement operation failed.");
}
