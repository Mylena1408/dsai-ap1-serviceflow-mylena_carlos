import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import * as exporting from "./application/export-configuration";
import { createPrismaConfigurationExportStore } from "./infrastructure/prisma-configuration-export";

// The portable configuration (SPEC 2026-11-07-operacao-e-automacao, part D). The import arrives in SF-188
// and SF-189.
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
