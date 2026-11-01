import { isAttachmentStorageKey } from "@/modules/attachments";
import { InternalServerError } from "@/server/errors";

// Private document storage behind an adapter (SPEC 21.8, 21.15). Server-side only: the
// secret key is read from server environment variables and never reaches the client.

export type DocumentStorageFailure =
  | "NOT_CONFIGURED"
  | "INVALID_KEY"
  | "ALREADY_EXISTS"
  | "NOT_FOUND"
  | "WRITE_FAILED"
  | "READ_FAILED"
  | "DELETE_FAILED"
  | "LIST_FAILED";

// The public message stays the generic internal error; `reason` is for server-side
// handling and logs and never carries keys, file names, content or provider details.
export class DocumentStorageError extends InternalServerError {
  constructor(readonly reason: DocumentStorageFailure) {
    super();
  }
}

/** One level of a listing: a folder (request id) or an object, with its creation time. */
export interface StorageEntry {
  name: string;
  isFolder: boolean;
  createdAt: Date | null;
}

export interface DocumentStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
  /**
   * Lists one level under "requests/" or "requests/<request id>/" (used by the orphan
   * cleanup, SPEC 21.15.5). Other prefixes are refused.
   */
  list(prefix: string): Promise<StorageEntry[]>;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const LIST_PREFIX_PATTERN = new RegExp(`^requests/(${UUID}/)?$`);

function assertListPrefix(prefix: string): void {
  if (!LIST_PREFIX_PATTERN.test(prefix)) {
    throw new DocumentStorageError("INVALID_KEY");
  }
}

export interface DocumentStorageConfig {
  url: string;
  bucket: string;
  secretKey: string;
}

export type DocumentStorageScope = "application" | "test";

const ENV_NAMES: Record<DocumentStorageScope, { url: string; bucket: string; secretKey: string }> = {
  application: {
    url: "DOCUMENT_STORAGE_URL",
    bucket: "DOCUMENT_STORAGE_BUCKET",
    secretKey: "DOCUMENT_STORAGE_SECRET_KEY",
  },
  test: {
    url: "TEST_DOCUMENT_STORAGE_URL",
    bucket: "TEST_DOCUMENT_STORAGE_BUCKET",
    secretKey: "TEST_DOCUMENT_STORAGE_SECRET_KEY",
  },
};

const BUCKET_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;

function assertStorageKey(key: string): void {
  if (!isAttachmentStorageKey(key)) {
    throw new DocumentStorageError("INVALID_KEY");
  }
}

// Returns null when the scope is not configured at all. Error messages name variables,
// never their values. Test configuration has no fallback to application variables.
export function getDocumentStorageConfig(
  scope: DocumentStorageScope,
  env: Record<string, string | undefined> = process.env,
): DocumentStorageConfig | null {
  const names = ENV_NAMES[scope];
  const url = env[names.url]?.trim() ?? "";
  const bucket = env[names.bucket]?.trim() ?? "";
  const secretKey = env[names.secretKey]?.trim() ?? "";

  if (!url && !bucket && !secretKey) {
    return null;
  }

  if (!url || !bucket || !secretKey) {
    throw new Error(`${names.url}, ${names.bucket} and ${names.secretKey} must be configured together.`);
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`${names.url} must be a valid URL.`);
  }

  const isLocalHost = ["localhost", "127.0.0.1"].includes(parsedUrl.hostname);

  if (parsedUrl.protocol !== "https:" && !(isLocalHost && parsedUrl.protocol === "http:")) {
    throw new Error(`${names.url} must use HTTPS.`);
  }

  if (!BUCKET_NAME_PATTERN.test(bucket)) {
    throw new Error(`${names.bucket} is not a valid bucket name.`);
  }

  if (scope === "test" && !bucket.endsWith("-test")) {
    throw new Error(`${names.bucket} must target a dedicated bucket whose name ends in -test.`);
  }

  if (!secretKey.startsWith("sb_secret_")) {
    throw new Error(`${names.secretKey} must be a dedicated secret key (sb_secret_...).`);
  }

  return { url: parsedUrl.origin, bucket, secretKey };
}

// Without DOCUMENT_STORAGE_* every operation fails with a fixed error, so requests with
// files are refused and nothing is kept in a process-local store. Services without
// document requirements never touch the storage.
export function createUnavailableDocumentStorage(): DocumentStorage {
  const unavailable = async (): Promise<never> => {
    throw new DocumentStorageError("NOT_CONFIGURED");
  };

  return { put: unavailable, get: unavailable, remove: unavailable, list: unavailable };
}

const END_TO_END_STORE = Symbol.for("serviceflow.e2eDocumentStorage");

/**
 * Memory storage for the browser tests (SPEC 21.15.7: automated tests use the memory
 * adapter). TEST_DOCUMENT_STORAGE=memory is accepted only outside production and with a
 * DATABASE_URL whose database name ends in _test. The store lives on globalThis because
 * Server Actions and route handlers may be loaded as separate bundles in one process.
 */
export function getEndToEndDocumentStorage(
  env: Record<string, string | undefined> = process.env,
): DocumentStorage | null {
  if (env.TEST_DOCUMENT_STORAGE === undefined || env.TEST_DOCUMENT_STORAGE === "") {
    return null;
  }

  if (env.TEST_DOCUMENT_STORAGE !== "memory") {
    throw new Error("TEST_DOCUMENT_STORAGE only accepts the value memory.");
  }

  if (env.NODE_ENV === "production") {
    throw new Error("TEST_DOCUMENT_STORAGE cannot be used in production.");
  }

  let databaseName = "";

  try {
    databaseName = decodeURIComponent(new URL(env.DATABASE_URL ?? "").pathname.replace(/^\/+/, ""));
  } catch {
    // Invalid or missing URL: rejected below.
  }

  if (!databaseName.toLowerCase().endsWith("_test")) {
    throw new Error("TEST_DOCUMENT_STORAGE requires a DATABASE_URL whose database name ends in _test.");
  }

  const holder = globalThis as { [END_TO_END_STORE]?: DocumentStorage };
  holder[END_TO_END_STORE] ??= createMemoryDocumentStorage();
  return holder[END_TO_END_STORE];
}

/**
 * Storage of the running application, from DOCUMENT_STORAGE_* (SPEC 21.15.7). The
 * configuration is read on first use, so operations that store no files never depend on it.
 */
export function getApplicationDocumentStorage(
  env: Record<string, string | undefined> = process.env,
): DocumentStorage {
  let resolved: DocumentStorage | undefined;
  const storage = () => {
    if (!resolved) {
      const config = getDocumentStorageConfig("application", env);
      resolved =
        getEndToEndDocumentStorage(env) ??
        (config ? createSupabaseDocumentStorage(config) : createUnavailableDocumentStorage());
    }

    return resolved;
  };

  return {
    put: async (key, bytes, contentType) => storage().put(key, bytes, contentType),
    get: async (key) => storage().get(key),
    remove: async (key) => storage().remove(key),
    list: async (prefix) => storage().list(prefix),
  };
}

/** Whether the running application has a document storage (real or E2E memory). */
export function isDocumentStorageConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return getEndToEndDocumentStorage(env) !== null || getDocumentStorageConfig("application", env) !== null;
}

export function createMemoryDocumentStorage(
  clock: () => Date = () => new Date(),
): DocumentStorage & { readonly size: number } {
  const objects = new Map<string, Uint8Array>();
  const createdAt = new Map<string, Date>();

  return {
    get size() {
      return objects.size;
    },
    async put(key, bytes) {
      assertStorageKey(key);

      if (objects.has(key)) {
        throw new DocumentStorageError("ALREADY_EXISTS");
      }

      objects.set(key, new Uint8Array(bytes));
      createdAt.set(key, clock());
    },
    async get(key) {
      assertStorageKey(key);
      const bytes = objects.get(key);

      if (!bytes) {
        throw new DocumentStorageError("NOT_FOUND");
      }

      return new Uint8Array(bytes);
    },
    async remove(key) {
      assertStorageKey(key);
      objects.delete(key);
      createdAt.delete(key);
    },
    async list(prefix) {
      assertListPrefix(prefix);
      const entries = new Map<string, StorageEntry>();

      for (const key of objects.keys()) {
        if (!key.startsWith(prefix)) continue;
        const [name, ...rest] = key.slice(prefix.length).split("/");
        entries.set(name, {
          name,
          isFolder: rest.length > 0,
          createdAt: rest.length > 0 ? null : (createdAt.get(key) ?? null),
        });
      }

      return [...entries.values()];
    },
  };
}

// Supabase Storage HTTP API without an SDK dependency (SPEC 21.15.8). Routes follow the
// storage-api server: POST/DELETE /object/{bucket}/{path} and
// GET /object/authenticated/{bucket}/{path}. Upsert stays disabled. The secret key goes in
// the `apikey` header, as Supabase documents for non-JWT keys. Not yet exercised against a
// real bucket (SF-030 provisioning pending).
export function createSupabaseDocumentStorage(
  config: DocumentStorageConfig,
  fetchImplementation: typeof fetch = fetch,
): DocumentStorage {
  const objectUrl = (key: string, authenticated = false) =>
    `${config.url}/storage/v1/object/${authenticated ? "authenticated/" : ""}${encodeURIComponent(
      config.bucket,
    )}/${key}`;
  const headers = { apikey: config.secretKey };

  async function send(url: string, init: RequestInit, failure: DocumentStorageFailure) {
    try {
      return await fetchImplementation(url, { ...init, cache: "no-store" });
    } catch {
      throw new DocumentStorageError(failure);
    }
  }

  return {
    async put(key, bytes, contentType) {
      assertStorageKey(key);
      const response = await send(
        objectUrl(key),
        {
          method: "POST",
          headers: { ...headers, "content-type": contentType, "x-upsert": "false" },
          body: new Blob([new Uint8Array(bytes)], { type: contentType }),
        },
        "WRITE_FAILED",
      );

      if (response.status === 409) {
        throw new DocumentStorageError("ALREADY_EXISTS");
      }

      if (!response.ok) {
        throw new DocumentStorageError("WRITE_FAILED");
      }
    },
    async get(key) {
      assertStorageKey(key);
      const response = await send(objectUrl(key, true), { method: "GET", headers }, "READ_FAILED");

      if (response.status === 404) {
        throw new DocumentStorageError("NOT_FOUND");
      }

      if (!response.ok) {
        throw new DocumentStorageError("READ_FAILED");
      }

      try {
        return new Uint8Array(await response.arrayBuffer());
      } catch {
        throw new DocumentStorageError("READ_FAILED");
      }
    },
    async list(prefix) {
      assertListPrefix(prefix);
      const entries: StorageEntry[] = [];
      const pageSize = 1000;

      for (let offset = 0; ; offset += pageSize) {
        const response = await send(
          `${config.url}/storage/v1/object/list/${encodeURIComponent(config.bucket)}`,
          {
            method: "POST",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({
              prefix: prefix.replace(/\/$/, ""),
              limit: pageSize,
              offset,
              sortBy: { column: "name", order: "asc" },
            }),
          },
          "LIST_FAILED",
        );

        if (!response.ok) {
          throw new DocumentStorageError("LIST_FAILED");
        }

        let page: Array<{ name?: unknown; id?: unknown; created_at?: unknown }>;
        try {
          page = await response.json();
        } catch {
          throw new DocumentStorageError("LIST_FAILED");
        }

        for (const item of page) {
          if (typeof item.name !== "string") continue;
          entries.push({
            name: item.name,
            isFolder: item.id === null || item.id === undefined,
            createdAt: typeof item.created_at === "string" ? new Date(item.created_at) : null,
          });
        }

        if (page.length < pageSize) {
          return entries;
        }
      }
    },
    async remove(key) {
      assertStorageKey(key);
      const response = await send(objectUrl(key), { method: "DELETE", headers }, "DELETE_FAILED");

      if (!response.ok && response.status !== 404) {
        throw new DocumentStorageError("DELETE_FAILED");
      }
    },
  };
}
