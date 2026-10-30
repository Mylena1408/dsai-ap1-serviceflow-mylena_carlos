import { requireRequestCreator } from "@/server/authorization";
import { NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { requestCreationInputSchema } from "./request-schemas";
import { assertServiceCanReceiveRequests } from "@/modules/services";
import type { RequestWithHistory } from "../domain/request";
import { buildRequestSnapshot } from "../domain/snapshot";
import type { RequestTransactionRunner } from "./ports";

export async function createRequest(
  input: unknown,
  transactions: RequestTransactionRunner,
): Promise<RequestWithHistory> {
  const actor = await requireRequestCreator();
  const parsed = validateInput(requestCreationInputSchema, input);

  return transactions.run(async (transaction) => {
    const currentActor = await transaction.findActor(actor.id);

    if (
      !currentActor ||
      !currentActor.isActive ||
      currentActor.role !== "REQUESTER"
    ) {
      throw new NotFoundError();
    }

    const service = await transaction.findServiceForRequest(parsed.serviceId);

    if (!service) {
      throw new NotFoundError();
    }

    assertServiceCanReceiveRequests({
      isActive: service.isActive,
      categoryActive: service.category.isActive,
      sectorActive: service.sector.isActive,
    });

    const openedAt = await transaction.currentTime();
    const created = await transaction.insertRequest({
      ...buildRequestSnapshot(currentActor.id, service),
      description: parsed.description,
      status: "OPEN",
      openedAt,
    });

    await transaction.insertStatusEvent({
      requestId: created.id,
      actorId: currentActor.id,
      fromStatus: null,
      toStatus: "OPEN",
      occurredAt: openedAt,
    });

    return transaction.getWithHistory(created.id);
  });
}
