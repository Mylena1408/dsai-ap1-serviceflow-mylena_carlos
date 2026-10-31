import { randomUUID } from "node:crypto";
import {
  createSupabaseDocumentStorage,
  DocumentStorageError,
  type DocumentStorageConfig,
} from "../src/server/storage";

// Bucket settings from SPEC 2026-09-30, section 21.15.7. They are an extra defense: the
// server still inspects every file (section 21.7).
export const DOCUMENT_BUCKET_SETTINGS = {
  public: false,
  file_size_limit: 2 * 1024 * 1024,
  allowed_mime_types: [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
  ],
} as const;

export type ProvisioningStep =
  | "bucket-created"
  | "bucket-updated"
  | "settings-confirmed"
  | "object-written"
  | "anonymous-public-read-denied"
  | "anonymous-authenticated-read-denied"
  | "object-read-back"
  | "object-removed";

export class ProvisioningError extends Error {}

interface BucketDetails {
  public?: boolean;
  file_size_limit?: number | null;
  allowed_mime_types?: string[] | null;
}

/**
 * Creates or updates the private bucket and proves, with a synthetic object, that the
 * server key can write, read and remove while anonymous reads are refused (SF-030).
 * Messages carry HTTP status codes only: never the key, the URL with the key or content.
 */
export async function provisionDocumentBucket(
  config: DocumentStorageConfig,
  fetchImplementation: typeof fetch = fetch,
): Promise<ProvisioningStep[]> {
  const steps: ProvisioningStep[] = [];
  const api = `${config.url}/storage/v1`;
  const bucket = encodeURIComponent(config.bucket);
  const headers = { apikey: config.secretKey };
  const json = { ...headers, "content-type": "application/json" };

  async function send(url: string, init: RequestInit = {}) {
    try {
      return await fetchImplementation(url, { ...init, cache: "no-store" });
    } catch {
      throw new ProvisioningError("O Supabase Storage não respondeu (falha de rede).");
    }
  }

  const existing = await send(`${api}/bucket/${bucket}`, { headers });

  if (existing.ok) {
    const updated = await send(`${api}/bucket/${bucket}`, {
      method: "PUT",
      headers: json,
      body: JSON.stringify(DOCUMENT_BUCKET_SETTINGS),
    });
    if (!updated.ok) {
      throw new ProvisioningError(`Falha ao atualizar o bucket (HTTP ${updated.status}).`);
    }
    steps.push("bucket-updated");
  } else if ([400, 404].includes(existing.status)) {
    const created = await send(`${api}/bucket`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ id: config.bucket, name: config.bucket, ...DOCUMENT_BUCKET_SETTINGS }),
    });
    if (!created.ok) {
      throw new ProvisioningError(`Falha ao criar o bucket (HTTP ${created.status}).`);
    }
    steps.push("bucket-created");
  } else {
    throw new ProvisioningError(
      `Falha ao consultar o bucket (HTTP ${existing.status}). Confira a URL e a chave secreta.`,
    );
  }

  const readBack = await send(`${api}/bucket/${bucket}`, { headers });
  const details = (readBack.ok ? await readBack.json() : {}) as BucketDetails;
  const mimeTypes = [...(details.allowed_mime_types ?? [])].sort();

  if (
    details.public !== false ||
    details.file_size_limit !== DOCUMENT_BUCKET_SETTINGS.file_size_limit ||
    JSON.stringify(mimeTypes) !== JSON.stringify([...DOCUMENT_BUCKET_SETTINGS.allowed_mime_types].sort())
  ) {
    throw new ProvisioningError("O bucket não ficou com a configuração exigida (privado, 2 MiB, 3 tipos).");
  }
  steps.push("settings-confirmed");

  // Synthetic probe under the same opaque key format the application uses.
  const storage = createSupabaseDocumentStorage(config, fetchImplementation);
  const key = `requests/${randomUUID()}/${randomUUID()}`;
  const content = new TextEncoder().encode("ServiceFlow storage probe - synthetic content.\n");

  await storage.put(key, content, "text/plain");
  steps.push("object-written");

  try {
    const anonymousPublic = await send(`${api}/object/public/${bucket}/${key}`);
    if (anonymousPublic.ok) {
      throw new ProvisioningError("Leitura anônima pela URL pública foi PERMITIDA: o bucket não é privado.");
    }
    steps.push("anonymous-public-read-denied");

    const anonymousAuthenticated = await send(`${api}/object/authenticated/${bucket}/${key}`);
    if (anonymousAuthenticated.ok) {
      throw new ProvisioningError("Leitura sem credencial pela rota autenticada foi PERMITIDA.");
    }
    steps.push("anonymous-authenticated-read-denied");

    const read = await storage.get(key);
    if (Buffer.compare(Buffer.from(read), Buffer.from(content)) !== 0) {
      throw new ProvisioningError("O conteúdo lido do bucket difere do enviado.");
    }
    steps.push("object-read-back");
  } finally {
    await storage.remove(key);
  }

  try {
    await storage.get(key);
    throw new ProvisioningError("O objeto de teste continuou acessível depois da remoção.");
  } catch (error) {
    if (!(error instanceof DocumentStorageError && error.reason === "NOT_FOUND")) throw error;
  }
  steps.push("object-removed");

  return steps;
}
