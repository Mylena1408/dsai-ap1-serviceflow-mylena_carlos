// Cleanup of attachment objects left behind by a failed compensation (SPEC 2026-09-30,
// section 21.15.5; SPEC 2026-10-31-eventos-outbox-jobs, section 7). Objects are written as
// requests/<request id>/<attachment id> before the request transaction, so a folder whose
// request does not exist only holds orphans. Objects newer than 24 hours are kept, so a
// creation still in progress is never touched.

export const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface OrphanCleanupStorage {
  list(prefix: string): Promise<Array<{ name: string; isFolder: boolean; createdAt: Date | null }>>;
  remove(key: string): Promise<void>;
}

export interface RequestExistenceReader {
  /** The subset of `requestIds` that exist in the database. */
  existingRequestIds(requestIds: string[]): Promise<Set<string>>;
}

export interface OrphanCleanupSummary {
  removed: number;
  kept: number;
}

export async function cleanOrphanAttachmentObjects(
  storage: OrphanCleanupStorage,
  requests: RequestExistenceReader,
  now: Date,
): Promise<OrphanCleanupSummary> {
  const summary: OrphanCleanupSummary = { removed: 0, kept: 0 };
  const folders = (await storage.list("requests/"))
    .filter(({ isFolder, name }) => isFolder && UUID_PATTERN.test(name))
    .map(({ name }) => name);

  if (folders.length === 0) {
    return summary;
  }

  const existing = await requests.existingRequestIds(folders);

  for (const requestId of folders.filter((id) => !existing.has(id))) {
    for (const entry of await storage.list(`requests/${requestId}/`)) {
      const oldEnough =
        !entry.isFolder &&
        entry.createdAt !== null &&
        now.getTime() - entry.createdAt.getTime() > ORPHAN_MIN_AGE_MS;

      if (oldEnough && UUID_PATTERN.test(entry.name)) {
        await storage.remove(`requests/${requestId}/${entry.name}`);
        summary.removed += 1;
      } else {
        summary.kept += 1;
      }
    }
  }

  return summary;
}
