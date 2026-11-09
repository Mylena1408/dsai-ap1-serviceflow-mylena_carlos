import { test, type APIResponse } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

// Details of an intermittent "not found" (NOTES, 2026-11-09: 404 in downloads and in an API call, seen only on the local
// machine, never reproduced with the server's log on). When a response is not the expected one, this writes what the
// server answered and what the database holds at that moment, then the test's own assertion fails as before. Nothing
// changes when the response is the expected one.

export interface FailureContext {
  /** The request the call was about. */
  requestId: string;
  /** E-mail of the person (session or API token owner) who made the call. */
  actorEmail: string;
  /** The comment file or document asked for, when the call was a download. */
  commentFileId?: string;
  attachmentId?: string;
}

export async function explainUnexpectedStatus(label: string, response: APIResponse, expected: number, context: FailureContext): Promise<void> {
  if (response.status() === expected) return;

  const database = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  let state: Record<string, unknown> = {};
  try {
    const [request, actor, commentFile, attachment] = await Promise.all([
      database.request.findUnique({
        where: { id: context.requestId },
        select: { id: true, status: true, sectorId: true, requesterId: true, assigneeId: true, serviceId: true, createdAt: true },
      }),
      database.user.findUnique({ where: { email: context.actorEmail }, select: { id: true, role: true, sectorId: true, isActive: true } }),
      context.commentFileId
        ? database.requestCommentFile.findUnique({
            where: { id: context.commentFileId },
            select: { requestId: true, commentId: true, storageKey: true, removedAt: true, comment: { select: { isInternal: true } } },
          })
        : null,
      context.attachmentId ? database.requestAttachment.findUnique({ where: { id: context.attachmentId }, select: { requestId: true, storageKey: true } }) : null,
    ]);
    const sameSector = Boolean(request && actor && request.sectorId === actor.sectorId);
    state = { request, actor, sameSector, ownRequest: Boolean(request && actor && request.requesterId === actor.id), commentFile, attachment };
  } catch (error) {
    state = { stateError: String(error) };
  } finally {
    await database.$disconnect();
  }

  const details = {
    label,
    at: new Date().toISOString(),
    url: response.url(),
    status: response.status(),
    expected,
    contentType: response.headers()["content-type"] ?? null,
    body: (await response.text().catch(() => "")).slice(0, 500),
    ...state,
  };
  const text = JSON.stringify(details, null, 2);
  // In the log (readable in the CI run) and attached to the test's report.
  console.log(`E2E-FAILURE-DETAILS ${text}`);
  await test.info().attach(`${label}.json`, { body: text, contentType: "application/json" });
}
