import type { RequestFieldAnswer } from "../domain/field-answer";
import { authorizeRequestRead } from "./attachment-queries";
import type { FieldAnswerQueryRepository } from "./ports";

// Answers follow the same read rule as the request and its attachments (SPEC
// 2026-11-01-campos-personalizados, 5.5): the requester who opened it or an attendant of its
// current sector; administrators are denied, always as NotFoundError.
export async function listRequestFieldAnswers(
  requestId: unknown,
  repository: FieldAnswerQueryRepository,
): Promise<RequestFieldAnswer[]> {
  const id = await authorizeRequestRead(requestId, repository);

  return repository.listForRequest(id);
}
