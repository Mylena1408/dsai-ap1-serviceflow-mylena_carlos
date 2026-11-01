import { describe, expect, it } from "vitest";
import { isAuthorizedCronRequest } from "@/server/jobs/cron-auth";
import { createMemoryDocumentStorage, createSupabaseDocumentStorage, DocumentStorageError } from "@/server/storage";
import { cleanOrphanAttachmentObjects } from "@/modules/requests/application/orphan-cleanup";

// SPEC 2026-10-31-eventos-outbox-jobs, section 7 (SF-062).

const SECRET = "a-cron-secret-with-24-chars";
const keptRequest = "11111111-1111-4111-8111-111111111111";
const orphanRequest = "22222222-2222-4222-8222-222222222222";
const attachmentA = "33333333-3333-4333-8333-333333333331";
const attachmentB = "33333333-3333-4333-8333-333333333332";

describe("cron authorization (CA-EVT-05)", () => {
  it("accepts only the exact bearer secret", () => {
    expect(isAuthorizedCronRequest(`Bearer ${SECRET}`, SECRET)).toBe(true);
    for (const header of [null, "", SECRET, `Bearer ${SECRET}x`, `bearer ${SECRET}`, "Bearer wrong"]) {
      expect(isAuthorizedCronRequest(header, SECRET)).toBe(false);
    }
  });

  it("refuses everything when the secret is missing or shorter than 16 characters", () => {
    expect(isAuthorizedCronRequest("Bearer ", undefined)).toBe(false);
    expect(isAuthorizedCronRequest("Bearer short", "short")).toBe(false);
  });
});

describe("storage listing", () => {
  it("lists folders and objects one level at a time and refuses other prefixes", async () => {
    const storage = createMemoryDocumentStorage(() => new Date("2026-10-01T00:00:00Z"));
    await storage.put(`requests/${orphanRequest}/${attachmentA}`, new Uint8Array([1]), "text/plain");

    await expect(storage.list("requests/")).resolves.toEqual([{ name: orphanRequest, isFolder: true, createdAt: null }]);
    await expect(storage.list(`requests/${orphanRequest}/`)).resolves.toEqual([
      { name: attachmentA, isFolder: false, createdAt: new Date("2026-10-01T00:00:00Z") },
    ]);
    for (const prefix of ["", "/", "other/", "requests", `requests/${orphanRequest}`]) {
      await expect(storage.list(prefix)).rejects.toBeInstanceOf(DocumentStorageError);
    }
  });

  it("pages the Supabase listing and tells folders from objects (simulated HTTP)", async () => {
    const bodies: unknown[] = [];
    const fetchImplementation = (async (_url: RequestInfo | URL, init: RequestInit = {}) => {
      bodies.push(JSON.parse(String(init.body)));
      return Response.json([
        { name: orphanRequest, id: null, created_at: null },
        { name: attachmentA, id: "x", created_at: "2026-10-01T00:00:00Z" },
      ]);
    }) as typeof fetch;
    const storage = createSupabaseDocumentStorage(
      { url: "https://project.example.test", bucket: "serviceflow-documents-test", secretKey: "sb_secret_synthetic" },
      fetchImplementation,
    );

    await expect(storage.list("requests/")).resolves.toEqual([
      { name: orphanRequest, isFolder: true, createdAt: null },
      { name: attachmentA, isFolder: false, createdAt: new Date("2026-10-01T00:00:00Z") },
    ]);
    expect(bodies[0]).toMatchObject({ prefix: "requests", limit: 1000, offset: 0 });
  });
});

describe("orphan cleanup", () => {
  it("removes only objects older than 24 hours in folders without a request", async () => {
    let clock = new Date("2026-10-29T12:00:00Z");
    const storage = createMemoryDocumentStorage(() => clock);
    await storage.put(`requests/${orphanRequest}/${attachmentA}`, new Uint8Array([1]), "text/plain");
    await storage.put(`requests/${keptRequest}/${attachmentA}`, new Uint8Array([1]), "text/plain");
    clock = new Date("2026-10-31T11:00:00Z");
    await storage.put(`requests/${orphanRequest}/${attachmentB}`, new Uint8Array([1]), "text/plain");
    const existing = { existingRequestIds: async () => new Set([keptRequest]) };

    const summary = await cleanOrphanAttachmentObjects(storage, existing, new Date("2026-10-31T12:00:00Z"));

    expect(summary).toEqual({ removed: 1, kept: 1 });
    await expect(storage.get(`requests/${orphanRequest}/${attachmentA}`)).rejects.toBeInstanceOf(DocumentStorageError);
    await expect(storage.get(`requests/${orphanRequest}/${attachmentB}`)).resolves.toBeTruthy();
    await expect(storage.get(`requests/${keptRequest}/${attachmentA}`)).resolves.toBeTruthy();
  });
});
