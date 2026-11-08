import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import * as exporting from "./application/export-configuration";
import { createPrismaConfigurationExportStore } from "./infrastructure/prisma-configuration-export";
import * as preview from "./application/preview-import";
import { createPrismaConfigurationImportStore } from "./infrastructure/prisma-configuration-import";
import * as applying from "./application/apply-import";
import { createPrismaConfigurationApplyStore } from "./infrastructure/prisma-configuration-apply";

// The portable configuration (SPEC 2026-11-07-operacao-e-automacao, part D): the export, the import's
// preview (SF-188) and its application (SF-189).
export {
  CONFIGURATION_FORMAT,
  CONFIGURATION_VERSION,
  MAX_CONFIGURATION_BYTES,
  configurationDataSchema,
  configurationFileSchema,
  keyOf,
  repeatedKeys,
  type ConfigurationData,
  type ConfigurationFile,
} from "./domain/format";
export { buildConfigurationData, buildConfigurationFile, configurationFileName, type ConfigurationSnapshot } from "./domain/export";
export type { ConfigurationExport } from "./application/export-configuration";
export { CONFIGURATION_ENTITY_ID, CONFIGURATION_ENTITY_LABEL } from "./infrastructure/prisma-configuration-export";

export function exportConfiguration(database: PrismaClient = prisma): Promise<exporting.ConfigurationExport> {
  return exporting.exportConfiguration(createPrismaConfigurationExportStore(database));
}

export { ITEM_KIND_LABELS, MAX_PREVIEW_PROBLEMS, type ItemKind, type ItemStatus, type PreviewItem, type PreviewMessage } from "./domain/preview";
export type { ImportPreview } from "./application/preview-import";

/** The import's preview: nothing is written (6.3 item 4). */
export function previewConfigurationImport(content: unknown, database: PrismaClient = prisma): Promise<preview.ImportPreview> {
  return preview.previewConfigurationImport(content, createPrismaConfigurationImportStore(database));
}

/** Applies a previewed file: all or nothing, refused when the file or the destination changed (6.3 item 5). */
export function applyConfigurationImport(input: unknown, database: PrismaClient = prisma) {
  return applying.applyConfigurationImport(input, createPrismaConfigurationApplyStore(database));
}
