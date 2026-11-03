import { requireCurrentActor } from "@/server/authorization";
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
  // SPEC 2026-11-03-campos-condicionais-atendimento, 5.6: the attendance's answers only for the team.
  const actor = await requireCurrentActor();
  const answers = await repository.listForRequest(id);

  return actor.role === "ATTENDANT" ? answers : answers.filter((answer) => answer.audience !== "ATTENDANT");
}
