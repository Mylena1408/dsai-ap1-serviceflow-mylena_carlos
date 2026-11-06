import type { RequestWithHistory } from "../domain/request";
import type { RequestTransactionRunner } from "./ports";

/**
 * Reads the full history of a request after its write transaction has committed (SPEC
 * 2026-11-06-transacao-abertura, 4.2): the ~15 queries of the history stay out of the write
 * transaction, in a short transaction of their own that sees everything just committed.
 */
export function readRequestAfterWrite(transactions: RequestTransactionRunner, requestId: string): Promise<RequestWithHistory> {
  return transactions.run((transaction) => transaction.getWithHistory(requestId));
}
