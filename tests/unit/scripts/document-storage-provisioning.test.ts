import { describe, expect, it } from "vitest";
import {
  DOCUMENT_BUCKET_SETTINGS,
  provisionDocumentBucket,
  ProvisioningError,
} from "../../../scripts/document-storage-provisioning";

const SECRET = "sb_secret_synthetic-value-for-tests";
const config = { url: "https://project.example.test", bucket: "serviceflow-documents-test", secretKey: SECRET };

interface FakeBucket {
  public: boolean;
  file_size_limit: number | null;
  allowed_mime_types: string[] | null;
}

/** Minimal Supabase Storage simulation: buckets, objects and anonymous access rules. */
function fakeSupabase(options: { bucket?: FakeBucket; ignoreUpdates?: boolean; key?: string } = {}) {
  const buckets = new Map<string, FakeBucket>();
  const objects = new Map<string, Uint8Array>();
  const calls: string[] = [];
  if (options.bucket) buckets.set(config.bucket, { ...options.bucket });

  const fetchImplementation = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    const authorized = headers.get("apikey") === (options.key ?? SECRET);
    const path = url.pathname.replace("/storage/v1", "");
    calls.push(`${method} ${path.split("/").slice(0, 3).join("/")}`);
    const body = init.body;

    if (path.startsWith("/bucket")) {
      if (!authorized) return new Response(null, { status: 401 });
      const id = decodeURIComponent(path.split("/")[2] ?? "");
      if (method === "POST") {
        const created = JSON.parse(String(body));
        buckets.set(created.id, {
          public: created.public,
          file_size_limit: created.file_size_limit,
          allowed_mime_types: created.allowed_mime_types,
        });
        return Response.json({ name: created.id });
      }
      const bucket = buckets.get(id);
      if (!bucket) return Response.json({ error: "Bucket not found" }, { status: 400 });
      if (method === "PUT") {
        if (!options.ignoreUpdates) Object.assign(bucket, JSON.parse(String(body)));
        return Response.json({ message: "Successfully updated" });
      }
      return Response.json({ id, ...bucket });
    }

    const [, , mode, , ...rest] = path.split("/");
    const objectKey = (mode === "public" || mode === "authenticated" ? rest : path.split("/").slice(3)).join("/");
    const bucket = buckets.get(config.bucket);

    if (mode === "public") {
      return bucket?.public && objects.has(objectKey)
        ? new Response(new Blob([new Uint8Array(objects.get(objectKey)!)]))
        : Response.json({ error: "not found" }, { status: 400 });
    }
    if (!authorized) return new Response(null, { status: 400 });
    if (mode === "authenticated") {
      const bytes = objects.get(objectKey);
      return bytes ? new Response(new Blob([new Uint8Array(bytes)])) : new Response(null, { status: 404 });
    }
    if (method === "POST") {
      objects.set(objectKey, new Uint8Array(await (body as Blob).arrayBuffer()));
      return Response.json({ Key: objectKey });
    }
    if (method === "DELETE") {
      objects.delete(objectKey);
      return Response.json({});
    }
    return new Response(null, { status: 405 });
  }) as typeof fetch;

  return { fetchImplementation, buckets, objects, calls };
}

const fullSequence = [
  "settings-confirmed",
  "object-written",
  "anonymous-public-read-denied",
  "anonymous-authenticated-read-denied",
  "object-read-back",
  "object-removed",
];

describe("document bucket provisioning (SF-030)", () => {
  it("creates a missing private bucket and proves anonymous reads are denied", async () => {
    const supabase = fakeSupabase();

    const steps = await provisionDocumentBucket(config, supabase.fetchImplementation);

    expect(steps).toEqual(["bucket-created", ...fullSequence]);
    expect(supabase.buckets.get(config.bucket)).toEqual({
      public: false,
      file_size_limit: 2 * 1024 * 1024,
      allowed_mime_types: [...DOCUMENT_BUCKET_SETTINGS.allowed_mime_types],
    });
    expect(supabase.objects.size).toBe(0);
  });

  it("turns an existing public bucket private with the required limits", async () => {
    const supabase = fakeSupabase({
      bucket: { public: true, file_size_limit: null, allowed_mime_types: null },
    });

    const steps = await provisionDocumentBucket(config, supabase.fetchImplementation);

    expect(steps).toEqual(["bucket-updated", ...fullSequence]);
    expect(supabase.buckets.get(config.bucket)?.public).toBe(false);
  });

  it("stops before writing anything when the bucket stays public", async () => {
    const supabase = fakeSupabase({
      bucket: { public: true, file_size_limit: null, allowed_mime_types: null },
      ignoreUpdates: true,
    });

    await expect(provisionDocumentBucket(config, supabase.fetchImplementation)).rejects.toThrow(
      "não ficou com a configuração exigida",
    );
    expect(supabase.objects.size).toBe(0);
  });

  it("reports a rejected key by HTTP status without echoing the key", async () => {
    const supabase = fakeSupabase({ key: "sb_secret_other" });

    const error = await provisionDocumentBucket(config, supabase.fetchImplementation).catch((caught) => caught);

    expect(error).toBeInstanceOf(ProvisioningError);
    expect(error.message).toContain("HTTP 401");
    expect(error.message).not.toContain(SECRET);
    expect(supabase.calls).toEqual(["GET /bucket/serviceflow-documents-test"]);
  });

  it("reports network failures with a fixed message", async () => {
    const failing = (async () => {
      throw new Error(`connect failed ${SECRET}`);
    }) as typeof fetch;

    const error = await provisionDocumentBucket(config, failing).catch((caught) => caught);

    expect(error).toBeInstanceOf(ProvisioningError);
    expect(error.message).toBe("O Supabase Storage não respondeu (falha de rede).");
  });
});
