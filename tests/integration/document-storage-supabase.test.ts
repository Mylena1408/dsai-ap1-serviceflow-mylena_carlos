import { describe, expect, it } from "vitest";
import { getDocumentStorageConfig } from "@/server/storage";
import { provisionDocumentBucket } from "../../scripts/document-storage-provisioning";

// Real Supabase Storage contract (SPEC 21.15.7, SF-030/SF-033). Runs only with
// TEST_DOCUMENT_STORAGE_* configured, against a bucket whose name ends in -test.
const config = getDocumentStorageConfig("test");

describe.skipIf(!config)("Supabase document storage (real test bucket)", () => {
  it("keeps the bucket private and writes, reads and removes with the server key", async () => {
    const steps = await provisionDocumentBucket(config!);

    expect(steps).toContain("settings-confirmed");
    expect(steps).toContain("anonymous-public-read-denied");
    expect(steps).toContain("anonymous-authenticated-read-denied");
    expect(steps).toContain("object-read-back");
    expect(steps.at(-1)).toBe("object-removed");
  }, 60_000);
});
