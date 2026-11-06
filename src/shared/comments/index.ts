// Shared by the server and the canned-response picker in the browser (SPEC
// 2026-11-06-respostas-prontas, 4.4): no server-only import here.

/** Text after "Inserir": what is already written, a blank line, then the inserted text. */
export function appendToComment(current: string, inserted: string): string {
  const base = current.replace(/\s+$/, "");
  return base === "" ? inserted : `${base}\n\n${inserted}`;
}
