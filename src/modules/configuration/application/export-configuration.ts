import type { AuditActor } from "@/modules/audit";
import { requireConfigurationAdministrator } from "@/server/authorization";
import { buildConfigurationFile, configurationFileName, type ConfigurationSnapshot } from "../domain/export";
import { MAX_CONFIGURATION_BYTES, repeatedKeys } from "../domain/format";

// Exporting the organization's configuration (SPEC 2026-11-07-operacao-e-automacao, 6.3 items 1 to 3): only
// the administrator; the export enters the audit trail. Names repeated in the same scope do not stop the
// export, but are reported, because the import matches by name (decision H14).

export interface ConfigurationExportStore {
  snapshot(): Promise<ConfigurationSnapshot>;
  now(): Promise<Date>;
  /** The audit entry of the export ("Exportou · Configuração da organização"). */
  recordExport(actor: AuditActor, exportedAt: Date): Promise<void>;
}

export interface ConfigurationExport {
  fileName: string;
  /** The file's text, as downloaded. */
  content: string;
  bytes: number;
  /** "serviços: Troca de lâmpada": names that will stop this file from being imported. */
  repeated: string[];
  /** Over the 2 MB the import accepts. */
  tooLarge: boolean;
}

export async function exportConfiguration(store: ConfigurationExportStore): Promise<ConfigurationExport> {
  const actor = await requireConfigurationAdministrator();
  const [snapshot, exportedAt] = await Promise.all([store.snapshot(), store.now()]);
  const file = buildConfigurationFile(snapshot, exportedAt);
  const content = `${JSON.stringify(file, null, 2)}\n`;
  const bytes = new TextEncoder().encode(content).length;

  await store.recordExport(actor, exportedAt);
  return {
    fileName: configurationFileName(exportedAt),
    content,
    bytes,
    repeated: repeatedKeys(file.data),
    tooLarge: bytes > MAX_CONFIGURATION_BYTES,
  };
}
