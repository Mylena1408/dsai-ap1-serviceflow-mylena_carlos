import { keyOf, repeatedKeys, type ConfigurationData } from "./format";

// The import's preview (SPEC 2026-11-07-operacao-e-automacao, 6.3 item 4): each item of the file is
// matched by its natural key with what exists and classified as new, changed (with the fields that change)
// or equal; people cited by e-mail who do not exist or cannot take the role are warnings, and the item goes
// in without them. The rules of the screens are checked in ./validation.

export type ItemKind =
  | "sector"
  | "escalationRule"
  | "cannedResponse"
  | "tag"
  | "category"
  | "service"
  | "field"
  | "document"
  | "stage"
  | "article"
  | "checklistItem"
  | "accessRole"
  | "calendar"
  | "holiday"
  | "bundle";

export type ItemStatus = "new" | "changed" | "equal";

export interface PreviewItem {
  kind: ItemKind;
  /** "Acesso a sistema › Sistema" for an item inside another; the name alone otherwise. */
  label: string;
  status: ItemStatus;
  /** The fields that change, for a changed item. */
  changes: string[];
}

export interface PreviewMessage {
  /** Where in the file: "services › Acesso a sistema › fields › Sistema › options". */
  path: string;
  message: string;
}

export interface DestinationPerson {
  id: string;
  email: string;
  role: "ADMIN" | "REQUESTER" | "ATTENDANT" | "MANAGER";
  isActive: boolean;
  sectorName: string | null;
}

export const ITEM_KIND_LABELS: Record<ItemKind, string> = {
  sector: "Setor",
  escalationRule: "Regra de escalonamento",
  cannedResponse: "Resposta pronta",
  tag: "Etiqueta",
  category: "Categoria",
  service: "Serviço",
  field: "Campo",
  document: "Documento exigido",
  stage: "Etapa",
  article: "Artigo",
  checklistItem: "Item de checklist",
  accessRole: "Papel",
  calendar: "Calendário",
  holiday: "Feriado",
  bundle: "Pacote",
};

export const MAX_PREVIEW_PROBLEMS = 50;

/** Nested lists are items of their own, never a field that changes. */
const NESTED = new Set(["escalationRules", "cannedResponses", "tags", "fields", "documents", "stages", "articles", "checklist"]);

export function changedFields(file: object, destination: object): string[] {
  const left = file as Record<string, unknown>;
  const right = destination as Record<string, unknown>;
  return Object.keys(left).filter((key) => !NESTED.has(key) && JSON.stringify(left[key]) !== JSON.stringify(right[key]));
}

export function classify<T extends object>(item: T, destination: T | undefined): { status: ItemStatus; changes: string[] } {
  if (!destination) return { status: "new", changes: [] };
  const changes = changedFields(item, destination);
  return { status: changes.length === 0 ? "equal" : "changed", changes };
}

export const byKey = <T>(items: readonly T[], key: (item: T) => string) => new Map(items.map((item) => [keyOf(key(item)), item]));

export const pathOf = (...segments: string[]) => segments.join(" › ");

// People (decision H13): only by e-mail. The value the destination already has is kept as it is, so
// exporting and importing back in the same environment changes nothing (6.3 item 6).

type PersonCheck = (person: DestinationPerson) => boolean;

export function personFits(email: string | null, people: ReadonlyMap<string, DestinationPerson>, fits: PersonCheck): boolean {
  if (email === null) return true;
  const person = people.get(keyOf(email));
  return person !== undefined && fits(person);
}

const attendantOf = (sectorName: string): PersonCheck => (person) =>
  person.isActive && person.role === "ATTENDANT" && person.sectorName !== null && keyOf(person.sectorName) === keyOf(sectorName);
const attendantOrManagerOf = (sectorName: string): PersonCheck => (person) =>
  person.isActive && (person.role === "ATTENDANT" || person.role === "MANAGER") && person.sectorName !== null && keyOf(person.sectorName) === keyOf(sectorName);

/**
 * The file's data as it would be applied: people who do not exist or cannot take the role are left out,
 * each with a warning, unless the destination already has that same person there.
 */
export function withoutUnfitPeople(
  data: ConfigurationData,
  destination: ConfigurationData,
  people: ReadonlyMap<string, DestinationPerson>,
): { data: ConfigurationData; warnings: PreviewMessage[] } {
  const warnings: PreviewMessage[] = [];
  const destinationSectors = byKey(destination.sectors, (sector) => sector.name);
  const destinationServices = byKey(destination.services, (service) => service.name);
  const warn = (path: string, email: string, role: string) =>
    warnings.push({ path, message: `${email} não existe neste ambiente ou não pode ser ${role}; o item entra sem essa pessoa.` });

  const sectors = data.sectors.map((sector) => {
    const currentRules = byKey(destinationSectors.get(keyOf(sector.name))?.escalationRules ?? [], (rule) => rule.name);
    return {
      ...sector,
      escalationRules: sector.escalationRules.map((rule) => {
        const current = currentRules.get(keyOf(rule.name));
        const path = pathOf("sectors", sector.name, "escalationRules", rule.name);
        let assignTo = rule.assignTo;
        if (assignTo !== null && assignTo !== current?.assignTo && !personFits(assignTo, people, attendantOf(sector.name))) {
          warn(pathOf(path, "assignTo"), assignTo, `atendente ativo do setor ${sector.name}`);
          assignTo = null;
        }
        const notify = rule.notify.filter((email) => {
          if (current?.notify.includes(email) || personFits(email, people, attendantOrManagerOf(sector.name))) return true;
          warn(pathOf(path, "notify"), email, `atendente ou gestor ativo do setor ${sector.name}`);
          return false;
        });
        return { ...rule, assignTo, notify };
      }),
    };
  });

  const services = data.services.map((service) => {
    const currentStages = byKey(destinationServices.get(keyOf(service.name))?.stages ?? [], (stage) => stage.name);
    return {
      ...service,
      stages: service.stages.map((stage) => {
        const current = currentStages.get(keyOf(stage.name));
        if (stage.assignee === null || stage.assignee === current?.assignee || personFits(stage.assignee, people, attendantOf(service.sector))) {
          return stage;
        }
        warn(pathOf("services", service.name, "stages", stage.name, "assignee"), stage.assignee, `atendente ativo do setor ${service.sector}`);
        return { ...stage, assignee: null };
      }),
    };
  });

  return { data: { ...data, sectors, services }, warnings };
}

/** Every item of the file with its classification against the destination. */
export function classifyItems(data: ConfigurationData, destination: ConfigurationData): PreviewItem[] {
  const items: PreviewItem[] = [];
  const add = (kind: ItemKind, label: string, result: { status: ItemStatus; changes: string[] }) => items.push({ kind, label, ...result });

  const sectors = byKey(destination.sectors, (sector) => sector.name);
  for (const sector of data.sectors) {
    const current = sectors.get(keyOf(sector.name));
    add("sector", sector.name, classify(sector, current));
    const rules = byKey(current?.escalationRules ?? [], (rule) => rule.name);
    for (const rule of sector.escalationRules) add("escalationRule", pathOf(sector.name, rule.name), classify(rule, rules.get(keyOf(rule.name))));
    const responses = byKey(current?.cannedResponses ?? [], (response) => response.title);
    for (const response of sector.cannedResponses) {
      add("cannedResponse", pathOf(sector.name, response.title), classify(response, responses.get(keyOf(response.title))));
    }
    // A version 1 file has no tags: nothing to classify.
    const tags = byKey(current?.tags ?? [], (tag) => tag.name);
    for (const tag of sector.tags ?? []) add("tag", pathOf(sector.name, tag.name), classify(tag, tags.get(keyOf(tag.name))));
  }

  const categories = byKey(destination.categories, (category) => category.name);
  for (const category of data.categories) add("category", category.name, classify(category, categories.get(keyOf(category.name))));

  const services = byKey(destination.services, (service) => service.name);
  for (const service of data.services) {
    const current = services.get(keyOf(service.name));
    add("service", service.name, classify(service, current));
    const fields = byKey(current?.fields ?? [], (field) => field.label);
    for (const field of service.fields) add("field", pathOf(service.name, field.label), classify(field, fields.get(keyOf(field.label))));
    const documents = byKey(current?.documents ?? [], (document) => document.name);
    for (const document of service.documents) add("document", pathOf(service.name, document.name), classify(document, documents.get(keyOf(document.name))));
    const stages = byKey(current?.stages ?? [], (stage) => stage.name);
    for (const stage of service.stages) add("stage", pathOf(service.name, stage.name), classify(stage, stages.get(keyOf(stage.name))));
    const articles = byKey(current?.articles ?? [], (article) => article.title);
    for (const article of service.articles) add("article", pathOf(service.name, article.title), classify(article, articles.get(keyOf(article.title))));
    const checklist = byKey(current?.checklist ?? [], (item) => item.text);
    for (const item of service.checklist ?? []) add("checklistItem", pathOf(service.name, item.text), classify(item, checklist.get(keyOf(item.text))));
  }

  const roles = byKey(destination.accessRoles, (role) => role.name);
  for (const role of data.accessRoles) add("accessRole", role.name, classify(role, roles.get(keyOf(role.name))));

  // Without a calendar in the file, the destination's stays as it is.
  if (data.calendar) add("calendar", "Calendário", classify(data.calendar, destination.calendar ?? undefined));

  const holidays = byKey(destination.holidays, (holiday) => holiday.day);
  for (const holiday of data.holidays) add("holiday", `${holiday.day} ${holiday.name}`, classify(holiday, holidays.get(keyOf(holiday.day))));

  const bundles = byKey(destination.bundles, (bundle) => bundle.name);
  for (const bundle of data.bundles) add("bundle", bundle.name, classify(bundle, bundles.get(keyOf(bundle.name))));

  return items;
}

/**
 * Decision H14 matches by name: a name repeated in the file, or a name of the file that the destination
 * has more than once, cannot be matched (clarification of SF-187).
 */
export function keyProblems(data: ConfigurationData, destinationRepeated: readonly string[]): PreviewMessage[] {
  const fileKeys = new Set(collectKeys(data));
  return [
    ...repeatedKeys(data).map((entry) => ({ path: entry, message: "Nome repetido no arquivo: cada item precisa de um nome único no seu grupo." })),
    ...destinationRepeated
      .filter((entry) => fileKeys.has(scopedKey(entry)))
      .map((entry) => ({ path: entry, message: "Este nome aparece mais de uma vez neste ambiente; renomeie um deles antes de importar." })),
  ];
}

/** "serviços: Mesa" → a comparable key: scope and name, ignoring case. */
const scopedKey = (entry: string) => keyOf(entry);

function collectKeys(data: ConfigurationData): string[] {
  const keys: string[] = [];
  const push = (scope: string, names: readonly string[]) => names.forEach((name) => keys.push(scopedKey(`${scope}: ${name}`)));
  push("setores", data.sectors.map((sector) => sector.name));
  push("categorias", data.categories.map((category) => category.name));
  push("serviços", data.services.map((service) => service.name));
  push("papéis", data.accessRoles.map((role) => role.name));
  push("pacotes", data.bundles.map((bundle) => bundle.name));
  push("feriados", data.holidays.map((holiday) => holiday.day));
  for (const sector of data.sectors) {
    push(`${sector.name} › regras de escalonamento`, sector.escalationRules.map((rule) => rule.name));
    push(`${sector.name} › respostas prontas`, sector.cannedResponses.map((response) => response.title));
    push(`${sector.name} › etiquetas`, (sector.tags ?? []).map((tag) => tag.name));
  }
  for (const service of data.services) {
    push(`${service.name} › campos`, service.fields.map((field) => field.label));
    push(`${service.name} › documentos`, service.documents.map((document) => document.name));
    push(`${service.name} › etapas`, service.stages.map((stage) => stage.name));
    push(`${service.name} › artigos`, service.articles.map((article) => article.title));
    push(`${service.name} › checklist`, (service.checklist ?? []).map((item) => item.text));
  }
  return keys;
}
