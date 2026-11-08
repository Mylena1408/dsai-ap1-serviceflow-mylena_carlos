import { createHash } from "node:crypto";
import { requireConfigurationAdministrator } from "@/server/authorization";
import { buildConfigurationData, type ConfigurationSnapshot } from "../domain/export";
import { MAX_CONFIGURATION_BYTES, configurationFileSchema, keyOf, repeatedKeys, type ConfigurationData } from "../domain/format";
import {
  MAX_PREVIEW_PROBLEMS,
  classifyItems,
  keyProblems,
  withoutUnfitPeople,
  type DestinationPerson,
  type ItemStatus,
  type PreviewItem,
  type PreviewMessage,
} from "../domain/preview";
import { validateConfiguration, type DestinationFacts } from "../domain/validation";

// The import's preview (SPEC 2026-11-07-operacao-e-automacao, 6.3 item 4; decision H12): only the
// administrator. The file is read whole; any problem refuses it, with the list (up to 50) and where each one
// is. Otherwise every item is classified and the people who stay out are warnings. Nothing is written: the
// application (SF-189) confirms the same file (by its digest) against the same destination.

export interface ConfigurationImportStore {
  snapshot(): Promise<ConfigurationSnapshot>;
  facts(): Promise<DestinationFacts>;
  /** The people with these e-mails (compared ignoring case). */
  people(emails: readonly string[]): Promise<DestinationPerson[]>;
}

export interface ImportPreview {
  /** Whether the file can be applied: no problems. */
  accepted: boolean;
  problems: PreviewMessage[];
  /** All the problems found, when more than the 50 listed. */
  problemCount: number;
  warnings: PreviewMessage[];
  items: PreviewItem[];
  summary: Record<ItemStatus, number>;
  /** SHA-256 of the file's text and of the destination's configuration, for the application. */
  digest: string;
  destinationDigest: string;
}

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** The destination's configuration as the file would carry it, and its digest. */
export function destinationOf(snapshot: ConfigurationSnapshot): { data: ConfigurationData; digest: string } {
  const data = buildConfigurationData(snapshot);
  return { data, digest: sha256(JSON.stringify(data)) };
}

function refusal(problems: PreviewMessage[], digest: string, destinationDigest: string): ImportPreview {
  return {
    accepted: false,
    problems: problems.slice(0, MAX_PREVIEW_PROBLEMS),
    problemCount: problems.length,
    warnings: [],
    items: [],
    summary: { new: 0, changed: 0, equal: 0 },
    digest,
    destinationDigest,
  };
}

/** Every e-mail the file cites. */
function citedEmails(data: ConfigurationData): string[] {
  const emails = new Set<string>();
  for (const sector of data.sectors) {
    for (const rule of sector.escalationRules) {
      if (rule.assignTo) emails.add(keyOf(rule.assignTo));
      for (const email of rule.notify) emails.add(keyOf(email));
    }
  }
  for (const service of data.services) for (const stage of service.stages) if (stage.assignee) emails.add(keyOf(stage.assignee));
  return [...emails];
}

/** What the preview finds, also used by the application with the destination read in its transaction. */
export interface ImportEvaluation extends ImportPreview {
  /** The file's data without the people who stay out, as it is applied. */
  effective: ConfigurationData | null;
  /** The people the file cites, by e-mail ignoring case. */
  people: ReadonlyMap<string, DestinationPerson>;
  /** The destination's configuration as the file would carry it. */
  destination: ConfigurationData;
}

export async function previewConfigurationImport(content: unknown, store: ConfigurationImportStore): Promise<ImportPreview> {
  await requireConfigurationAdministrator();
  const evaluation = await evaluateImport(content, store);
  return {
    accepted: evaluation.accepted,
    problems: evaluation.problems,
    problemCount: evaluation.problemCount,
    warnings: evaluation.warnings,
    items: evaluation.items,
    summary: evaluation.summary,
    digest: evaluation.digest,
    destinationDigest: evaluation.destinationDigest,
  };
}

export async function evaluateImport(content: unknown, store: ConfigurationImportStore): Promise<ImportEvaluation> {
  const text = typeof content === "string" ? content : "";
  const digest = sha256(text);
  const destination = destinationOf(await store.snapshot());
  const none = new Map<string, DestinationPerson>();
  const refused = (problems: PreviewMessage[]): ImportEvaluation => ({
    ...refusal(problems, digest, destination.digest),
    effective: null,
    people: none,
    destination: destination.data,
  });

  if (new TextEncoder().encode(text).length > MAX_CONFIGURATION_BYTES) {
    return refused([{ path: "arquivo", message: "O arquivo passa de 2 MB." }]);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return refused([{ path: "arquivo", message: "O arquivo não é um JSON válido." }]);
  }
  const shape = configurationFileSchema.safeParse(parsed);
  if (!shape.success) {
    const problems = shape.error.issues.map((issue) => ({
      path: issue.path.length > 0 ? issue.path.map(String).join(" › ") : "arquivo",
      message:
        issue.path[0] === "format" || issue.path[0] === "version"
          ? "Não é um arquivo de configuração do ServiceFlow nesta versão."
          : "Campo ausente, a mais ou com valor fora do formato.",
    }));
    return refused(problems);
  }

  const file = shape.data.data;
  const keys = keyProblems(file, repeatedKeys(destination.data));
  if (keys.length > 0) return refused(keys);

  const people = new Map((await store.people(citedEmails(file))).map((person) => [keyOf(person.email), person]));
  const effective = withoutUnfitPeople(file, destination.data, people);
  const problems = validateConfiguration(effective.data, destination.data, await store.facts());
  if (problems.length > 0) return refused(problems);

  const items = classifyItems(effective.data, destination.data);
  const summary: Record<ItemStatus, number> = { new: 0, changed: 0, equal: 0 };
  for (const item of items) summary[item.status] += 1;

  return {
    accepted: true,
    problems: [],
    problemCount: 0,
    warnings: effective.warnings,
    items,
    summary,
    digest,
    destinationDigest: destination.digest,
    effective: effective.data,
    people,
    destination: destination.data,
  };
}
