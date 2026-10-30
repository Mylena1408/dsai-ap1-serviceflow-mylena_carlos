/** Transaction runner over an in-memory store that restores the previous state when work throws. */
export function createRollbackRunner<Store extends object, Transaction>(
  store: Store,
  createTransaction: (store: Store) => Transaction,
) {
  return {
    async run<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
      const before = structuredClone(store);
      try {
        return await work(createTransaction(store));
      } catch (error) {
        Object.assign(store, before);
        throw error;
      }
    },
  };
}

let sequence = 0;

/** Deterministic UUID-shaped identifiers for in-memory records. */
export function nextTestId(): string {
  sequence += 1;
  return `00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

export const testNow = new Date("2026-10-29T12:00:00.000Z");
