import { loadEnvConfig } from "@next/env";
import { loadEnv } from "vite";
import { getDocumentStorageConfig, type DocumentStorageScope } from "../src/server/storage";
import { provisionDocumentBucket } from "./document-storage-provisioning";

// Usage: npm run storage:provision            (DOCUMENT_STORAGE_*, from .env.local)
//        npm run storage:provision -- test    (TEST_DOCUMENT_STORAGE_*, from .env.test.local)
async function main(): Promise<void> {
  const scope: DocumentStorageScope = process.argv[2] === "test" ? "test" : "application";
  const env =
    scope === "test"
      ? { ...loadEnv("test", process.cwd(), "TEST_DOCUMENT_STORAGE_"), ...process.env }
      : (loadEnvConfig(process.cwd()), process.env);

  const config = getDocumentStorageConfig(scope, env);

  if (!config) {
    const prefix = scope === "test" ? "TEST_DOCUMENT_STORAGE" : "DOCUMENT_STORAGE";
    throw new Error(`Configure ${prefix}_URL, ${prefix}_BUCKET e ${prefix}_SECRET_KEY antes de provisionar.`);
  }

  console.log(`Provisionando o bucket "${config.bucket}" (${scope})...`);
  for (const step of await provisionDocumentBucket(config)) {
    console.log(`- ok: ${step}`);
  }
  console.log("Bucket privado configurado e verificado.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Falha ao provisionar o armazenamento.");
  process.exitCode = 1;
});
