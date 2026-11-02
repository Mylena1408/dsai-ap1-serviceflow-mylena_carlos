import { requireCurrentActor } from "@/server/authorization";
import { NotFoundError } from "@/server/errors";
import { buildPersonalDataExport, personalDataFileName } from "../domain/personal-data";
import type { PersonalDataReader } from "./ports";

// "Meus dados" (SPEC 2026-11-02-auditoria-lgpd, 5.4, decision D3): any profile downloads only its
// own data. The identity comes from the session; there is no user parameter.

export interface PersonalDataFile {
  fileName: string;
  content: string;
}

export async function exportPersonalData(reader: PersonalDataReader, now: Date): Promise<PersonalDataFile> {
  const actor = await requireCurrentActor();
  const source = await reader.load(actor.id);

  if (!source) {
    throw new NotFoundError();
  }

  await reader.recordExport({ id: actor.id, role: actor.role });

  return {
    fileName: personalDataFileName(now),
    content: `${JSON.stringify(buildPersonalDataExport(source, now), null, 2)}\n`,
  };
}
