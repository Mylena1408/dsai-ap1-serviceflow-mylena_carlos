import { describe, expect, it } from "vitest";
import {
  DocumentStorageError,
  getApplicationDocumentStorage,
  getEndToEndDocumentStorage,
} from "@/server/storage";

const key = "requests/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222";
const testDatabase = "postgresql://user:password@127.0.0.1:54329/serviceflow_test";

describe("application document storage selection", () => {
  it("refuses files with a fixed error when nothing is configured", async () => {
    const storage = getApplicationDocumentStorage({});

    await expect(storage.put(key, new Uint8Array([1]), "text/plain")).rejects.toMatchObject({
      reason: "NOT_CONFIGURED",
    });
    await expect(storage.get(key)).rejects.toBeInstanceOf(DocumentStorageError);
  });

  it("reads the configuration only when the storage is used", async () => {
    const storage = getApplicationDocumentStorage({ DOCUMENT_STORAGE_URL: "https://example.test" });

    await expect(storage.get(key)).rejects.toThrow("must be configured together");
  });

  it("shares one memory store across callers in E2E mode", async () => {
    const env = { TEST_DOCUMENT_STORAGE: "memory", NODE_ENV: "development", DATABASE_URL: testDatabase };
    const writer = getApplicationDocumentStorage(env);
    const reader = getApplicationDocumentStorage(env);

    await writer.put(key, new Uint8Array([1, 2, 3]), "text/plain");
    await expect(reader.get(key)).resolves.toEqual(new Uint8Array([1, 2, 3]));
    await reader.remove(key);
  });

  it("accepts E2E memory storage only outside production with a _test database", () => {
    expect(getEndToEndDocumentStorage({})).toBeNull();
    expect(() =>
      getEndToEndDocumentStorage({ TEST_DOCUMENT_STORAGE: "disk", DATABASE_URL: testDatabase }),
    ).toThrow("only accepts the value memory");
    expect(() =>
      getEndToEndDocumentStorage({
        TEST_DOCUMENT_STORAGE: "memory",
        NODE_ENV: "production",
        DATABASE_URL: testDatabase,
      }),
    ).toThrow("cannot be used in production");
    for (const DATABASE_URL of [
      "postgresql://user:password@127.0.0.1:54329/serviceflow_dev",
      "not a url",
      undefined,
    ]) {
      expect(() =>
        getEndToEndDocumentStorage({ TEST_DOCUMENT_STORAGE: "memory", DATABASE_URL }),
      ).toThrow("ends in _test");
    }
  });
});
