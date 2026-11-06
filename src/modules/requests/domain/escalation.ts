import type { RequestPriority } from "./request";

// Automatic escalation of overdue requests (SPEC 2026-11-06-escalonamento, 4.3): one priority
// level up, never past urgent.

const ORDER: readonly RequestPriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];

export function escalatedPriority(priority: RequestPriority): RequestPriority {
  const index = ORDER.indexOf(priority);
  return ORDER[Math.min(index + 1, ORDER.length - 1)] ?? priority;
}
