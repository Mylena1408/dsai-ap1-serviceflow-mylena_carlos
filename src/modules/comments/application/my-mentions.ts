import { requireCurrentActor } from "@/server/authorization";
import { NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";

// "Minhas menções" (SPEC 2026-11-08-atendimento-dia-a-dia, 13.4 item 1; decision J8; correction of 13.10): the
// attendant's mentions, only on requests they still read (their current sector), most recent first; opening one
// marks it as seen and leads to the request's conversation.

export const MY_MENTIONS_LIMIT = 50;

export interface MyMention {
  commentId: string;
  requestId: string;
  serviceName: string;
  authorName: string;
  createdAt: Date;
  seenAt: Date | null;
}

export interface MyMentionsReader {
  list(userId: string, sectorId: string, limit: number): Promise<MyMention[]>;
  countUnseen(userId: string, sectorId: string): Promise<number>;
  /** Marks the person's mention as seen, when it is on a request of the sector; returns its request, or null. */
  markSeen(commentId: string, userId: string, sectorId: string, at: Date): Promise<string | null>;
}

async function attendant() {
  const actor = await requireCurrentActor();
  return actor.role === "ATTENDANT" && actor.sectorId ? { id: actor.id, sectorId: actor.sectorId } : null;
}

export async function listMyMentions(reader: MyMentionsReader): Promise<MyMention[]> {
  const actor = await attendant();
  return actor ? reader.list(actor.id, actor.sectorId, MY_MENTIONS_LIMIT) : [];
}

/** For the menu's count; nobody else has mentions. */
export async function countUnseenMentions(reader: MyMentionsReader): Promise<number> {
  const actor = await attendant();
  return actor ? reader.countUnseen(actor.id, actor.sectorId) : 0;
}

/** Opening a mention: marks it seen (once) and returns the request to open; anything else is "not found". */
export async function openMention(commentId: unknown, reader: MyMentionsReader, now = new Date()): Promise<string> {
  const actor = await attendant();
  const id = validateInput(entityIdSchema, commentId);
  const requestId = actor ? await reader.markSeen(id, actor.id, actor.sectorId, now) : null;
  if (!requestId) throw new NotFoundError();
  return requestId;
}
