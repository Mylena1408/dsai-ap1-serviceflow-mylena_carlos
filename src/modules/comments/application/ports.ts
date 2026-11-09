import type { DomainEvent } from "@/modules/events";
import type { DetectedDocumentFormat } from "@/modules/attachments";
import type { CommentReader, CommentRequestScope } from "../domain/comment-policy";

/** A file of a comment as shown in the conversation (SPEC 2026-11-03-anexos-comentarios-documentos). */
export interface CommentFileSummary {
  id: string;
  originalFilename: string;
  detectedFormat: DetectedDocumentFormat;
  sizeBytes: number;
  /** Removed by an anonymization (SPEC 2026-11-02-auditoria-lgpd, 5.5). */
  removed: boolean;
}

export interface CommentRecord {
  id: string;
  requestId: string;
  body: string;
  isInternal: boolean;
  createdAt: Date;
  author: { id: string; name: string; role: "ADMIN" | "REQUESTER" | "ATTENDANT" | "MANAGER" };
  /** Always loaded from the database; optional so records built before the files stay valid. */
  files?: CommentFileSummary[];
  /** SPEC 2026-11-08-atendimento-dia-a-dia, 7.3 item 3: the names of the colleagues an internal note mentions. */
  mentions?: string[];
}

export interface NewComment {
  /** Generated before the transaction when files are attached, so their rows can point to it. */
  id?: string;
  requestId: string;
  authorId: string;
  body: string;
  isInternal: boolean;
  createdAt: Date;
}

/** File row; every field is derived on the server (5.1). */
export interface NewCommentFile {
  id: string;
  requestId: string;
  commentId: string;
  originalFilename: string;
  detectedFormat: DetectedDocumentFormat;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
  uploadedById: string;
  createdAt: Date;
}

/** What the download needs (5.2): never sent to the client except the content and the name. */
export interface StoredCommentFile {
  storageKey: string;
  originalFilename: string;
  contentType: string;
  isInternal: boolean;
  removed: boolean;
}

/** Reads shared by queries and transactions. */
export interface CommentScopeReader {
  findReader(userId: string): Promise<CommentReader | null>;
  findRequestScope(requestId: string): Promise<CommentRequestScope | null>;
}

export interface CommentRepository extends CommentScopeReader {
  /** SPEC 2026-11-08-atendimento-dia-a-dia, 7.3 item 1: the active attendants of a sector. Optional for older doubles. */
  listMentionable?(sectorId: string): Promise<Array<{ id: string; name: string }>>;
  /** Chronological, with files; internal notes only when `includeInternal`. */
  listForRequest(requestId: string, includeInternal: boolean): Promise<CommentRecord[]>;
  /** Number of comments per request id, internal notes only when `includeInternal`. */
  countForRequests(requestIds: string[], includeInternal: boolean): Promise<Map<string, number>>;
  /** A file of that comment of that request, or null. */
  findFile(requestId: string, commentId: string, fileId: string): Promise<StoredCommentFile | null>;
}

export interface CommentTransaction extends CommentScopeReader {
  /** Database time of the transaction (same clock as the request history). */
  currentTime(): Promise<Date>;
  insertComment(comment: NewComment): Promise<CommentRecord>;
  /** Comment files already in the request (5.1.3). */
  countFiles(requestId: string): Promise<number>;
  insertFiles(files: NewCommentFile[]): Promise<void>;
  /** Writes a domain event to the outbox in this same transaction. */
  recordEvent(event: DomainEvent): Promise<void>;
  /**
   * SPEC 2026-11-03-pausa-sla-calendario, 5.4.2: a public comment of the requester resumes a paused
   * SLA in this same transaction. Optional so doubles without SLA stay valid.
   */
  resumeSlaOnRequesterReply?(requestId: string, authorId: string): Promise<void>;
  /**
   * SPEC 2026-11-08-atendimento-dia-a-dia, 13.3 item 2 (decision J7): an attendant who comments starts following the
   * request in this same transaction, unless they already follow it or turned the preference off. Optional for
   * older doubles.
   */
  followOnComment?(requestId: string, authorId: string, at: Date): Promise<void>;
  /**
   * SPEC 2026-11-08-atendimento-dia-a-dia, 7.3 item 1: the active attendants of a sector, who may be mentioned, and
   * the mentions of a note. Optional for older doubles: absent = nobody may be mentioned.
   */
  listMentionableIds?(sectorId: string): Promise<string[]>;
  insertMentions?(commentId: string, userIds: readonly string[], at: Date): Promise<void>;
}

export interface CommentTransactionRunner {
  run<T>(work: (transaction: CommentTransaction) => Promise<T>): Promise<T>;
}

/** Private object storage for the content of the files (SPEC 2026-09-30, 21.8). */
export interface CommentFileStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
}
