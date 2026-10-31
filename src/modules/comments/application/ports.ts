import type { CommentReader, CommentRequestScope } from "../domain/comment-policy";

export interface CommentRecord {
  id: string;
  requestId: string;
  body: string;
  isInternal: boolean;
  createdAt: Date;
  author: { id: string; name: string; role: "ADMIN" | "REQUESTER" | "ATTENDANT" };
}

export interface NewComment {
  requestId: string;
  authorId: string;
  body: string;
  isInternal: boolean;
  createdAt: Date;
}

/** Reads shared by queries and transactions. */
export interface CommentScopeReader {
  findReader(userId: string): Promise<CommentReader | null>;
  findRequestScope(requestId: string): Promise<CommentRequestScope | null>;
}

export interface CommentRepository extends CommentScopeReader {
  /** Chronological; internal notes only when `includeInternal`. */
  listForRequest(requestId: string, includeInternal: boolean): Promise<CommentRecord[]>;
  /** Number of comments per request id, internal notes only when `includeInternal`. */
  countForRequests(requestIds: string[], includeInternal: boolean): Promise<Map<string, number>>;
}

export interface CommentTransaction extends CommentScopeReader {
  /** Database time of the transaction (same clock as the request history). */
  currentTime(): Promise<Date>;
  insertComment(comment: NewComment): Promise<CommentRecord>;
}

export interface CommentTransactionRunner {
  run<T>(work: (transaction: CommentTransaction) => Promise<T>): Promise<T>;
}
