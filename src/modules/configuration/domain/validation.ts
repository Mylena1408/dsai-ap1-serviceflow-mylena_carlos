import type { ZodType } from "zod";
import { categoryInputSchema } from "@/modules/categories";
import { parseCalendarInput, parseHolidayInput } from "@/modules/calendar";
import { cannedResponseInputSchema } from "@/modules/canned-responses";
import { documentRequirementInputSchema, MAX_ACTIVE_DOCUMENT_REQUIREMENTS } from "@/modules/document-requirements";
import { articleInputSchema } from "@/modules/knowledge";
import { accessRoleInputSchema } from "@/modules/permissions";
import {
  MAX_ESCALATION_RULES,
  assertSectorCanBeDeactivated,
  distributionSettingsSchema,
  escalationRuleSettingsSchema,
  sectorInputSchema,
} from "@/modules/sectors";
import { bundleInputSchema, serviceProblems } from "@/modules/service-bundles";
import {
  MAX_ACTIVE_SERVICE_FIELDS,
  assertConditionTarget,
  assertFieldTypeUnchanged,
  serviceFieldInputSchema,
  type ConditionController,
} from "@/modules/service-fields";
import { MAX_ACTIVE_SERVICE_STAGES, serviceStageInputSchema, serviceStageSettingsSchema } from "@/modules/service-stages";
import { assertApprovalLevels, parseSlaHours, serviceApprovalInputSchema, serviceInputSchema } from "@/modules/services";
import { ApplicationError, ValidationError } from "@/server/errors";
import { keyOf, type ConfigurationData, type FieldItem, type ServiceItem } from "./format";
import { byKey, classify, pathOf, type PreviewMessage } from "./preview";

// The import's preview checks the file with the same rules as each configuration screen (SPEC
// 2026-11-07-operacao-e-automacao, 6.3 item 4): the screens' own schemas and rules, applied to the state the
// import would leave (what exists plus what the file brings). Items equal to the destination change nothing
// and are not checked again, so exporting and importing back always works (6.3 item 6); the limits of a
// group are checked when the file changes something in it.

export interface DestinationFacts {
  /** Names of sectors with open or in-progress requests, and with active attendants. */
  sectorsWithPendingRequests: readonly string[];
  sectorsWithActiveAttendants: readonly string[];
}

/** Valid ids that stand for references resolved by name, so the screens' schemas can be reused. */
const placeholder = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

/** The file's names for the screens' field names. */
const FIELD_NAMES: Record<string, string> = {
  assignToId: "assignTo",
  notifyUserIds: "notify",
  categoryId: "category",
  sectorId: "sector",
  sectorIds: "approvalSectors",
  conditionFieldId: "condition",
  conditionValue: "condition",
  deadlineDays: "approvalDeadlineDays",
  assigneeId: "assignee",
  serviceIds: "services",
  actions: "ações",
};

const fieldName = (segment: PropertyKey | undefined) => (segment === undefined ? "" : (FIELD_NAMES[String(segment)] ?? String(segment)));

const merge = <T>(destination: readonly T[], file: readonly T[], key: (item: T) => string): Map<string, T> => {
  const merged = byKey(destination, key);
  for (const item of file) merged.set(keyOf(key(item)), item);
  return merged;
};

export function validateConfiguration(file: ConfigurationData, destination: ConfigurationData, facts: DestinationFacts): PreviewMessage[] {
  const problems: PreviewMessage[] = [];
  const problem = (path: string, message: string) => problems.push({ path, message });

  /** The screen's schema: each issue names the field, with the file's name for it. */
  const check = (schema: ZodType, input: unknown, path: string) => {
    const result = schema.safeParse(input);
    if (result.success) return;
    const seen = new Set<string>();
    for (const issue of result.error.issues) {
      const name = fieldName(issue.path[0]);
      if (seen.has(name)) continue;
      seen.add(name);
      problem(name ? pathOf(path, name) : path, "Não segue as regras da tela de configuração.");
    }
  };
  /**
   * A rule of the screen that throws, refused at `path`. With `named`, the field the refusal names is added
   * (only the public field names reach a ValidationError, so the caller gives the field otherwise).
   */
  const rule = (work: () => void, path: string, message: string, named = false) => {
    try {
      work();
    } catch (error) {
      if (!(error instanceof ApplicationError)) throw error;
      const name = named && error instanceof ValidationError ? fieldName(error.issues[0]?.path[0]) : "";
      problem(name ? pathOf(path, name) : path, message);
    }
  };
  const changing = <T extends object>(item: T, current: T | undefined) => classify(item, current).status !== "equal";

  // The state the import would leave.
  const sectors = merge(destination.sectors, file.sectors, (sector) => sector.name);
  const categories = merge(destination.categories, file.categories, (category) => category.name);
  const destinationServices = byKey(destination.services, (service) => service.name);
  const services = new Map(destinationServices);
  for (const service of file.services) {
    const current = destinationServices.get(keyOf(service.name));
    services.set(keyOf(service.name), {
      ...service,
      fields: [...merge(current?.fields ?? [], service.fields, (field) => field.label).values()],
      documents: [...merge(current?.documents ?? [], service.documents, (document) => document.name).values()],
      stages: [...merge(current?.stages ?? [], service.stages, (stage) => stage.name).values()],
      articles: [...merge(current?.articles ?? [], service.articles, (article) => article.title).values()],
    });
  }
  const activeSector = (name: string) => sectors.get(keyOf(name))?.isActive === true;
  const pending = new Set(facts.sectorsWithPendingRequests.map(keyOf));
  const attendants = new Set(facts.sectorsWithActiveAttendants.map(keyOf));

  // Sectors, their escalation rules and canned responses.
  const destinationSectors = byKey(destination.sectors, (sector) => sector.name);
  for (const sector of file.sectors) {
    const path = pathOf("sectors", sector.name);
    const current = destinationSectors.get(keyOf(sector.name));
    if (changing(sector, current)) {
      check(sectorInputSchema, { name: sector.name }, path);
      check(
        distributionSettingsSchema,
        { distributionMode: sector.distributionMode, maxActivePerAttendant: sector.maxActivePerAttendant, redistributeOnAbsence: sector.redistributeOnAbsence },
        path,
      );
      if (current?.isActive && !sector.isActive) {
        const hasActiveService = [...services.values()].some((service) => service.isActive && keyOf(service.sector) === keyOf(sector.name));
        rule(
          () =>
            assertSectorCanBeDeactivated({
              hasActiveService,
              hasPendingRequest: pending.has(keyOf(sector.name)),
              hasActiveAttendant: attendants.has(keyOf(sector.name)),
            }),
          pathOf(path, "isActive"),
          "Um setor com serviços ativos, solicitações em andamento ou atendentes ativos não pode ser desativado.",
        );
      }
    }

    const currentRules = byKey(current?.escalationRules ?? [], (item) => item.name);
    let rulesChanged = false;
    for (const item of sector.escalationRules) {
      if (!changing(item, currentRules.get(keyOf(item.name)))) continue;
      rulesChanged = true;
      check(
        escalationRuleSettingsSchema,
        {
          name: item.name,
          trigger: item.trigger,
          overdueDays: item.overdueDays,
          raisePriority: item.raisePriority,
          assignToId: item.assignTo === null ? null : placeholder(0),
          notifyManagers: item.notifyManagers,
          notifyTeam: item.notifyTeam,
          notifyUserIds: item.notify.map((_, index) => placeholder(index + 1)),
        },
        pathOf(path, "escalationRules", item.name),
      );
    }
    if (rulesChanged) {
      const active = [...merge(current?.escalationRules ?? [], sector.escalationRules, (item) => item.name).values()].filter((item) => item.isActive);
      if (active.length > MAX_ESCALATION_RULES) {
        problem(pathOf(path, "escalationRules"), `Um setor tem no máximo ${MAX_ESCALATION_RULES} regras de escalonamento ativas.`);
      }
      // The rule of `sameCombination` (same trigger and N), here also for a trigger the schema refuses.
      const same = (left: (typeof active)[number], right: (typeof active)[number]) =>
        left.trigger === right.trigger && (left.overdueDays ?? 0) === (right.overdueDays ?? 0);
      if (active.some((item, index) => active.findIndex((other) => same(other, item)) !== index)) {
        problem(pathOf(path, "escalationRules"), "Duas regras ativas do setor têm o mesmo gatilho.");
      }
    }

    const currentResponses = byKey(current?.cannedResponses ?? [], (item) => item.title);
    for (const item of sector.cannedResponses) {
      if (changing(item, currentResponses.get(keyOf(item.title)))) {
        check(cannedResponseInputSchema, { title: item.title, body: item.body }, pathOf(path, "cannedResponses", item.title));
      }
    }
  }

  // Categories.
  const destinationCategories = byKey(destination.categories, (category) => category.name);
  for (const category of file.categories) {
    const current = destinationCategories.get(keyOf(category.name));
    if (!changing(category, current)) continue;
    const path = pathOf("categories", category.name);
    check(categoryInputSchema, { name: category.name }, path);
    if (current?.isActive && !category.isActive && [...services.values()].some((service) => service.isActive && keyOf(service.category) === keyOf(category.name))) {
      problem(pathOf(path, "isActive"), "Uma categoria com serviços ativos não pode ser desativada.");
    }
  }

  // Services and what belongs to each.
  for (const service of file.services) {
    validateService(service, destinationServices.get(keyOf(service.name)), services.get(keyOf(service.name))!);
  }

  function controllerOf(merged: ServiceItem, label: string): ConditionController | null {
    const field = merged.fields.find((item) => keyOf(item.label) === keyOf(label));
    return field
      ? {
          id: keyOf(field.label),
          type: field.type,
          options: field.options,
          audience: field.audience,
          isActive: field.isActive,
          conditionFieldId: field.condition ? keyOf(field.condition.field) : null,
        }
      : null;
  }

  function validateService(service: ServiceItem, current: ServiceItem | undefined, merged: ServiceItem): void {
    const path = pathOf("services", service.name);
    if (changing(service, current)) {
      check(
        serviceInputSchema,
        {
          name: service.name,
          description: service.description,
          categoryId: placeholder(0),
          sectorId: placeholder(1),
          defaultPriority: service.defaultPriority,
          slaHours: service.slaHours,
          requiresApproval: service.requiresApproval,
          slaBusinessHours: service.slaBusinessHours,
        },
        path,
      );
      rule(() => parseSlaHours(service.slaHours), pathOf(path, "slaHours"), "O prazo em horas está fora dos limites da tela.");
      const category = categories.get(keyOf(service.category));
      const sector = sectors.get(keyOf(service.sector));
      if (!category) problem(pathOf(path, "category"), "Categoria não encontrada no arquivo nem neste ambiente.");
      if (!sector) problem(pathOf(path, "sector"), "Setor não encontrado no arquivo nem neste ambiente.");
      if (service.isActive && ((category && !category.isActive) || (sector && !sector.isActive))) {
        problem(path, "Um serviço ativo precisa de categoria e setor ativos.");
      }
      check(
        serviceApprovalInputSchema,
        {
          sectorIds: service.approvalSectors.map((_, index) => placeholder(index)),
          conditionFieldId: service.approvalCondition ? placeholder(9) : null,
          conditionValue: service.approvalCondition?.value ?? null,
          deadlineDays: service.approvalDeadlineDays,
        },
        path,
      );
      const levelKeys = service.approvalSectors.map(keyOf);
      rule(
        () => assertApprovalLevels(levelKeys, new Set([...sectors.values()].filter((item) => item.isActive).map((item) => keyOf(item.name)))),
        pathOf(path, "approvalSectors"),
        "Os setores de aprovação precisam existir, estar ativos e não se repetir em sequência.",
      );
      if (service.approvalCondition) {
        const { field, value } = service.approvalCondition;
        rule(
          () => assertConditionTarget({ id: null, audience: "REQUESTER" }, controllerOf(merged, field), value),
          pathOf(path, "approvalCondition"),
          "A condição da aprovação precisa de um campo ativo de escolha do serviço e de um valor entre as opções dele.",
        );
      }
    }

    const currentFields = byKey(current?.fields ?? [], (field) => field.label);
    let fieldsChanged = !current;
    for (const field of service.fields) {
      const existing = currentFields.get(keyOf(field.label));
      if (!changing(field, existing)) continue;
      fieldsChanged = true;
      validateField(field, existing, merged, pathOf(path, "fields", field.label));
    }
    if (fieldsChanged) {
      const active = merged.fields.filter((field) => field.isActive);
      if (active.length > MAX_ACTIVE_SERVICE_FIELDS) problem(pathOf(path, "fields"), `Um serviço tem no máximo ${MAX_ACTIVE_SERVICE_FIELDS} campos ativos.`);
      // A controller of an active field stays active and keeps the values its conditions use.
      for (const dependent of active) {
        if (!dependent.condition) continue;
        const controller = merged.fields.find((field) => keyOf(field.label) === keyOf(dependent.condition!.field));
        const keepsValue =
          controller?.type === "YES_NO" ? ["true", "false"].includes(dependent.condition.value) : controller?.options.includes(dependent.condition.value);
        if (!controller?.isActive || !keepsValue) {
          problem(
            pathOf(path, "fields", dependent.condition.field),
            `O campo controla a condição do campo ativo "${dependent.label}": precisa continuar ativo e com a opção "${dependent.condition.value}".`,
          );
        }
      }
    }

    const currentDocuments = byKey(current?.documents ?? [], (document) => document.name);
    let documentsChanged = false;
    for (const document of service.documents) {
      if (!changing(document, currentDocuments.get(keyOf(document.name)))) continue;
      documentsChanged = true;
      check(
        documentRequirementInputSchema,
        { name: document.name, isRequired: document.isRequired, acceptedFormats: document.acceptedFormats },
        pathOf(path, "documents", document.name),
      );
    }
    if (documentsChanged && merged.documents.filter((document) => document.isActive).length > MAX_ACTIVE_DOCUMENT_REQUIREMENTS) {
      problem(pathOf(path, "documents"), `Um serviço tem no máximo ${MAX_ACTIVE_DOCUMENT_REQUIREMENTS} documentos exigidos ativos.`);
    }

    const currentStages = byKey(current?.stages ?? [], (stage) => stage.name);
    let stagesChanged = false;
    for (const stage of service.stages) {
      if (!changing(stage, currentStages.get(keyOf(stage.name)))) continue;
      stagesChanged = true;
      const stagePath = pathOf(path, "stages", stage.name);
      check(serviceStageInputSchema, { name: stage.name }, stagePath);
      check(
        serviceStageSettingsSchema,
        {
          assigneeId: stage.assignee === null ? null : placeholder(0),
          targetDays: stage.targetDays,
          conditionFieldId: stage.condition ? placeholder(1) : null,
          conditionValue: stage.condition?.value ?? null,
        },
        stagePath,
      );
      if (stage.isActive && stage.condition) {
        const { field, value } = stage.condition;
        rule(
          () => assertConditionTarget({ id: null, audience: "REQUESTER" }, controllerOf(merged, field), value),
          pathOf(stagePath, "condition"),
          "A condição da etapa precisa de um campo ativo de escolha do serviço e de um valor entre as opções dele.",
        );
      }
    }
    if (stagesChanged && merged.stages.filter((stage) => stage.isActive).length > MAX_ACTIVE_SERVICE_STAGES) {
      problem(pathOf(path, "stages"), `Um serviço tem no máximo ${MAX_ACTIVE_SERVICE_STAGES} etapas ativas.`);
    }

    const currentArticles = byKey(current?.articles ?? [], (article) => article.title);
    for (const article of service.articles) {
      if (changing(article, currentArticles.get(keyOf(article.title)))) {
        check(articleInputSchema, { title: article.title, body: article.body, position: article.position }, pathOf(path, "articles", article.title));
      }
    }
  }

  function validateField(field: FieldItem, existing: FieldItem | undefined, merged: ServiceItem, path: string): void {
    check(
      serviceFieldInputSchema,
      {
        label: field.label,
        helpText: field.helpText,
        type: field.type,
        isRequired: field.isRequired,
        options: field.options,
        minValue: field.minValue,
        maxValue: field.maxValue,
        decimalPlaces: field.decimalPlaces,
        minDecimal: field.minDecimal,
        maxDecimal: field.maxDecimal,
        audience: field.audience,
        conditionFieldId: field.condition ? placeholder(0) : null,
        conditionValue: field.condition?.value ?? null,
      },
      path,
    );
    // The screens never change a field's type (SPEC 2026-11-01-campos-personalizados, 5.1).
    if (existing) rule(() => assertFieldTypeUnchanged(existing.type, field.type), pathOf(path, "type"), "O tipo de um campo existente não pode mudar.");
    if (field.isActive && field.condition) {
      const { field: controller, value } = field.condition;
      rule(
        () => assertConditionTarget({ id: keyOf(field.label), audience: field.audience }, controllerOf(merged, controller), value),
        pathOf(path, "condition"),
        "A condição precisa de outro campo ativo de escolha, do mesmo público e sem condição própria, e de um valor entre as opções dele.",
      );
    }
  }

  // Access roles.
  const destinationRoles = byKey(destination.accessRoles, (role) => role.name);
  for (const role of file.accessRoles) {
    if (changing(role, destinationRoles.get(keyOf(role.name)))) {
      check(accessRoleInputSchema, { name: role.name, description: role.description, permissions: role.permissions }, pathOf("accessRoles", role.name));
    }
  }

  // The calendar and the holidays.
  if (file.calendar && changing(file.calendar, destination.calendar ?? undefined)) {
    rule(() => parseCalendarInput(file.calendar!), "calendar", "O calendário não segue as regras da tela.", true);
  }
  const destinationHolidays = byKey(destination.holidays, (holiday) => holiday.day);
  for (const holiday of file.holidays) {
    if (changing(holiday, destinationHolidays.get(keyOf(holiday.day)))) {
      rule(() => parseHolidayInput(holiday), pathOf("holidays", holiday.day), "O feriado não segue as regras da tela.", true);
    }
  }

  // Bundles: an active bundle's services exist and may be in a bundle in the state left by the import.
  const destinationBundles = byKey(destination.bundles, (bundle) => bundle.name);
  for (const bundle of file.bundles) {
    if (!changing(bundle, destinationBundles.get(keyOf(bundle.name)))) continue;
    const path = pathOf("bundles", bundle.name);
    check(
      bundleInputSchema,
      { name: bundle.name, description: bundle.description, serviceIds: bundle.services.map((name, index) => (bundle.services.findIndex((other) => keyOf(other) === keyOf(name)) === index ? placeholder(index) : placeholder(0))) },
      path,
    );
    if (!bundle.isActive) continue;
    for (const name of bundle.services) {
      const service = services.get(keyOf(name));
      const usable =
        service !== undefined &&
        serviceProblems({
          id: name,
          name,
          sectorName: service.sector,
          isActive: service.isActive,
          categoryActive: categories.get(keyOf(service.category))?.isActive === true,
          sectorActive: activeSector(service.sector),
          activeRequirements: service.documents.filter((document) => document.isActive).length,
        }).length === 0;
      if (!usable) problem(pathOf(path, "services", name), "O serviço não existe ou não pode estar num pacote (inativo, com categoria ou setor inativo, ou com documentos exigidos).");
    }
  }

  return problems;
}
