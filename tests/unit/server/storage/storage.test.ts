import { describe, expect, it, vi } from "vitest";
import { toErrorResponse } from "@/server/errors";
import {
  DocumentStorageError,
  createMemoryDocumentStorage,
  createSupabaseDocumentStorage,
  getDocumentStorageConfig,
} from "@/server/storage";

const KEY = "requests/6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const SECRET = "sb_secret_synthetic-value-for-tests";
const CONFIG = { url: "https://example.supabase.co", bucket: "serviceflow-documents-test", secretKey: SECRET };
const BYTES = new TextEncoder().encode("conteudo sintetico");

async function captureStorageError(action: () => Promise<unknown>): Promise<DocumentStorageError> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(DocumentStorageError);
    return error as DocumentStorageError;
  }

  throw new Error("Expected a storage error.");
}

describe("document storage configuration", () => {
  const testEnv = {
    TEST_DOCUMENT_STORAGE_URL: "https://example.supabase.co/",
    TEST_DOCUMENT_STORAGE_BUCKET: "serviceflow-documents-test",
    TEST_DOCUMENT_STORAGE_SECRET_KEY: SECRET,
  };

  it("returns null when the scope is not configured", () => {
    expect(getDocumentStorageConfig("application", {})).toBeNull();
    expect(getDocumentStorageConfig("test", {})).toBeNull();
  });

  it("reads test variables without falling back to application variables", () => {
    expect(getDocumentStorageConfig("test", testEnv)).toEqual({
      url: "https://example.supabase.co",
      bucket: "serviceflow-documents-test",
      secretKey: SECRET,
    });
    expect(
      getDocumentStorageConfig("test", {
        DOCUMENT_STORAGE_URL: "https://example.supabase.co",
        DOCUMENT_STORAGE_BUCKET: "serviceflow-documents",
        DOCUMENT_STORAGE_SECRET_KEY: SECRET,
      }),
    ).toBeNull();
  });

  it("refuses a test bucket whose name does not end in -test", () => {
    expect(() =>
      getDocumentStorageConfig("test", { ...testEnv, TEST_DOCUMENT_STORAGE_BUCKET: "serviceflow-documents" }),
    ).toThrow(/-test/);
  });

  it.each([
    ["partial configuration", { TEST_DOCUMENT_STORAGE_URL: "https://example.supabase.co" }],
    ["plain HTTP outside localhost", { ...testEnv, TEST_DOCUMENT_STORAGE_URL: "http://example.supabase.co" }],
    ["an invalid bucket name", { ...testEnv, TEST_DOCUMENT_STORAGE_BUCKET: "Bucket_Test" }],
    ["a publishable key", { ...testEnv, TEST_DOCUMENT_STORAGE_SECRET_KEY: "sb_publishable_abc" }],
  ])("rejects %s without echoing secret values", (_label, env) => {
    let message = "";

    try {
      getDocumentStorageConfig("test", env);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).not.toBe("");
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain("sb_publishable_abc");
  });
});

describe("memory document storage", () => {
  it("stores, reads and removes objects without overwriting", async () => {
    const storage = createMemoryDocumentStorage();

    await storage.put(KEY, BYTES, "text/plain");
    expect(await storage.get(KEY)).toEqual(BYTES);
    expect((await captureStorageError(() => storage.put(KEY, BYTES, "text/plain"))).reason).toBe(
      "ALREADY_EXISTS",
    );

    await storage.remove(KEY);
    expect(storage.size).toBe(0);
    expect((await captureStorageError(() => storage.get(KEY))).reason).toBe("NOT_FOUND");
  });

  it("rejects keys outside the opaque requests/{uuid}/{uuid} format", async () => {
    const storage = createMemoryDocumentStorage();

    for (const key of ["../segredo", "requests/a/b", `${KEY}/../x`, "requerimento.pdf"]) {
      expect((await captureStorageError(() => storage.put(key, BYTES, "text/plain"))).reason).toBe(
        "INVALID_KEY",
      );
    }
  });
});

describe("Supabase document storage (simulated HTTP)", () => {
  function storageWith(response: Response | Error) {
    const fetchMock = vi.fn(async () => {
      if (response instanceof Error) {
        throw response;
      }

      return response;
    });

    return { fetchMock, storage: createSupabaseDocumentStorage(CONFIG, fetchMock as unknown as typeof fetch) };
  }

  it("uploads with the secret in the apikey header and upsert disabled", async () => {
    const { fetchMock, storage } = storageWith(new Response("{}", { status: 200 }));

    await storage.put(KEY, BYTES, "text/plain");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect(url).toBe(`https://example.supabase.co/storage/v1/object/serviceflow-documents-test/${KEY}`);
    expect(init.method).toBe("POST");
    expect(init.cache).toBe("no-store");
    expect(headers.apikey).toBe(SECRET);
    expect(headers.authorization).toBeUndefined();
    expect(headers["x-upsert"]).toBe("false");
    expect(headers["content-type"]).toBe("text/plain");
  });

  it("downloads through the authenticated endpoint and returns identical bytes", async () => {
    const { fetchMock, storage } = storageWith(new Response(BYTES, { status: 200 }));

    expect(await storage.get(KEY)).toEqual(BYTES);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      `https://example.supabase.co/storage/v1/object/authenticated/serviceflow-documents-test/${KEY}`,
    );
  });

  it("removes with DELETE and tolerates objects that are already gone", async () => {
    const { fetchMock, storage } = storageWith(new Response("", { status: 404 }));

    await expect(storage.remove(KEY)).resolves.toBeUndefined();
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe("DELETE");
  });

  it.each([
    ["put", 409, "ALREADY_EXISTS"],
    ["put", 500, "WRITE_FAILED"],
    ["get", 404, "NOT_FOUND"],
    ["get", 403, "READ_FAILED"],
    ["remove", 500, "DELETE_FAILED"],
  ] as const)("maps %s HTTP %i to %s with a fixed public error", async (operation, status, reason) => {
    const providerDetail = `provider detail with ${SECRET} and ${KEY}`;
    const { storage } = storageWith(new Response(providerDetail, { status }));
    const error = await captureStorageError(() =>
      operation === "put" ? storage.put(KEY, BYTES, "text/plain") : storage[operation](KEY),
    );
    const exposed = error.message + JSON.stringify(toErrorResponse(error));

    expect(error.reason).toBe(reason);
    expect(toErrorResponse(error).body.error.code).toBe("INTERNAL_ERROR");
    expect(exposed).not.toContain(SECRET);
    expect(exposed).not.toContain(KEY);
    expect(exposed).not.toContain("provider detail");
  });

  // Shapes observed on the hosted Storage API on 2026-11-05 (SF-030): HTTP 400 with the real
  // code in the body.
  const hosted = (statusCode: string, code: string) =>
    new Response(JSON.stringify({ statusCode, error: "x", message: `detail ${SECRET}`, code }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });

  it.each([
    ["put", "409", "KeyAlreadyExists", "ALREADY_EXISTS"],
    ["get", "404", "NoSuchKey", "NOT_FOUND"],
    ["put", "400", "InvalidRequest", "WRITE_FAILED"],
    ["get", "400", "InvalidRequest", "READ_FAILED"],
    ["get", "not-a-number", "InvalidRequest", "READ_FAILED"],
  ] as const)(
    "maps the hosted %s answer HTTP 400 with statusCode %s (%s) to %s",
    async (operation, statusCode, code, reason) => {
      const { storage } = storageWith(hosted(statusCode, code));
      const error = await captureStorageError(() =>
        operation === "put" ? storage.put(KEY, BYTES, "text/plain") : storage.get(KEY),
      );

      expect(error.reason).toBe(reason);
      expect(error.message + JSON.stringify(toErrorResponse(error))).not.toContain(SECRET);
    },
  );

  it("tolerates the hosted answer for removing an object that is already gone", async () => {
    const { storage } = storageWith(hosted("404", "NoSuchKey"));

    await expect(storage.remove(KEY)).resolves.toBeUndefined();
  });

  it.each([
    ["a JSON body with another code", () => hosted("403", "AccessDenied")],
    ["a body that is not JSON", () => new Response("not json", { status: 400 })],
  ])("still fails removal on HTTP 400 with %s", async (_label, response) => {
    const { storage } = storageWith(response());
    const error = await captureStorageError(() => storage.remove(KEY));

    expect(error.reason).toBe("DELETE_FAILED");
  });

  it("converts network failures into fixed errors", async () => {
    const { storage } = storageWith(new Error(`connect failed ${SECRET}`));
    const error = await captureStorageError(() => storage.get(KEY));

    expect(error.reason).toBe("READ_FAILED");
    expect(error.message).not.toContain(SECRET);
  });

  it("never calls the provider with an invalid key", async () => {
    const { fetchMock, storage } = storageWith(new Response("{}", { status: 200 }));

    await captureStorageError(() => storage.get("../../outro-bucket/objeto"));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
