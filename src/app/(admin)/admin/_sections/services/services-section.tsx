import type { CategoryRecord } from "@/modules/categories";
import {
  MAX_ACTIVE_DOCUMENT_REQUIREMENTS,
  type DocumentRequirementRecord,
} from "@/modules/document-requirements";
import type { SectorRecord } from "@/modules/sectors";
import { MAX_ACTIVE_SERVICE_FIELDS, type ServiceFieldRecord } from "@/modules/service-fields";
import { MAX_ACTIVE_SERVICE_STAGES, type ServiceStageRecord } from "@/modules/service-stages";
import type { ServiceRecord } from "@/modules/services";
import { AdminCreateForm } from "../../create-form";
import { DocumentRequirementsEditor } from "../../document-requirements-editor";
import { AdminRecordEditor } from "../../record-editor";
import { ServiceFieldsEditor } from "../../service-fields-editor";
import { ServiceStagesEditor } from "../../service-stages-editor";
import { ServiceApprovalEditor, type ApprovalConditionChoice } from "../../service-approval-editor";
import { AdminSectionProvider } from "../../section-context";
import { ServiceSlaFields } from "../../service-sla-fields";
import {
  createDocumentRequirementAction,
  createServiceAction,
  createServiceFieldAction,
  configureServiceApprovalAction,
  configureServiceStageAction,
  createServiceStageAction,
  deactivateDocumentRequirementAction,
  deactivateServiceFieldAction,
  deactivateServiceStageAction,
  moveDocumentRequirementAction,
  moveServiceFieldAction,
  moveServiceStageAction,
  reactivateServiceFieldAction,
  reactivateServiceStageAction,
  renameServiceStageAction,
  toggleServiceAction,
  updateDocumentRequirementAction,
  updateServiceAction,
  updateServiceFieldAction,
} from "./actions";

type ServicesSectionProps = {
  section: "services" | "sector-services";
  services: ServiceRecord[];
  categories: CategoryRecord[];
  sectors: SectorRecord[];
  documentRequirements: DocumentRequirementRecord[];
  serviceFields: ServiceFieldRecord[];
  serviceStages: ServiceStageRecord[];
  /** Active managers per sector id, to warn about services nobody can approve (SPEC de aprovações, 9). */
  /** Absent on the sector page, which does not read the users (SPEC de permissões, 5.3.1). */
  activeManagersBySector?: ReadonlyMap<string, number>;
  /** Active sectors any catalog editor may pick as approval levels (SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.1). */
  approvalSectors: Array<{ id: string; name: string }>;
  /** Active attendants with their sector, for the stages' attendant (5.3.1). */
  stageAssignees: Array<{ id: string; name: string; sectorId: string }>;
};

/**
 * Requester fields that may control the approval condition (SPEC
 * 2026-11-06-aprofundamento-configurabilidade, 4.3.7): active, of the opening, with choices and
 * without their own condition.
 */
function approvalConditionChoices(fields: readonly ServiceFieldRecord[], serviceId: string): ApprovalConditionChoice[] {
  return fields
    .filter(
      (field) =>
        field.serviceId === serviceId &&
        field.isActive &&
        field.audience === "REQUESTER" &&
        !field.conditionFieldId &&
        (field.type === "SELECT" || field.type === "YES_NO" || field.type === "MULTI_SELECT"),
    )
    .map((field) => ({ fieldId: field.id, label: field.label, type: field.type as ApprovalConditionChoice["type"], options: field.options }));
}

export function ServicesSection({
  section,
  services,
  categories,
  sectors,
  documentRequirements,
  serviceFields,
  serviceStages,
  activeManagersBySector,
  approvalSectors,
  stageAssignees,
}: ServicesSectionProps) {
  return (
    <AdminSectionProvider section={section}>
    <section className="admin-section" aria-labelledby="services-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Oferta de serviços</p>
            <h2 id="services-heading">Serviços</h2>
            <p className="section-description">Configure o que as pessoas podem solicitar e qual equipe atende.</p>
          </div>
        </div>
        <AdminCreateForm action={createServiceAction} submitLabel="Criar serviço">
          <label>Nome<input name="name" required /></label>
          <label className="wide-field">Descrição<textarea name="description" required /></label>
          <label>
            Categoria
            <select name="categoryId" required defaultValue="">
              <option value="" disabled>Selecione</option>
              {categories.filter((category) => category.isActive).map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </label>
          <label>
            Setor
            <select name="sectorId" required defaultValue="">
              <option value="" disabled>Selecione</option>
              {sectors.filter((sector) => sector.isActive).map((sector) => (
                <option key={sector.id} value={sector.id}>{sector.name}</option>
              ))}
            </select>
          </label>
          <ServiceSlaFields defaultPriority="NORMAL" requiresApproval={false} slaHours={null} />
        </AdminCreateForm>
        <ul className="entity-list">
          {services.map((service) => (
            <AdminRecordEditor
              key={service.id}
              record={{
                kind: "service",
                id: service.id,
                name: service.name,
                description: service.description,
                categoryId: service.categoryId,
                sectorId: service.sectorId,
                isActive: service.isActive,
                defaultPriority: service.defaultPriority,
                slaHours: service.slaHours,
                requiresApproval: service.requiresApproval,
                slaBusinessHours: service.slaBusinessHours,
              }}
              categories={categories}
              sectors={sectors}
              section={section}
              toggleAction={toggleServiceAction}
              updateAction={updateServiceAction}
            >
              {service.requiresApproval && activeManagersBySector ? (
                <p className={(activeManagersBySector.get(service.sectorId) ?? 0) === 0 ? "feedback feedback-error" : "section-description"}>
                  {(activeManagersBySector.get(service.sectorId) ?? 0) === 0
                    ? "Nenhum gestor ativo no setor deste serviço: as solicitações ficarão aguardando aprovação."
                    : `Gestores ativos no setor: ${activeManagersBySector.get(service.sectorId)}.`}
                </p>
              ) : null}
              <DocumentRequirementsEditor
                createAction={createDocumentRequirementAction}
                deactivateAction={deactivateDocumentRequirementAction}
                maxActive={MAX_ACTIVE_DOCUMENT_REQUIREMENTS}
                moveAction={moveDocumentRequirementAction}
                requirements={documentRequirements
                  .filter((requirement) => requirement.serviceId === service.id)
                  .map((requirement) => ({
                    id: requirement.id,
                    name: requirement.name,
                    isRequired: requirement.isRequired,
                    acceptedFormats: requirement.acceptedFormats,
                    isActive: requirement.isActive,
                  }))}
                serviceId={service.id}
                updateAction={updateDocumentRequirementAction}
              />
              <ServiceFieldsEditor
                createAction={createServiceFieldAction}
                deactivateAction={deactivateServiceFieldAction}
                fields={serviceFields
                  .filter((serviceField) => serviceField.serviceId === service.id)
                  .map((serviceField) => ({
                    id: serviceField.id,
                    label: serviceField.label,
                    helpText: serviceField.helpText,
                    type: serviceField.type,
                    isRequired: serviceField.isRequired,
                    options: serviceField.options,
                    minValue: serviceField.minValue,
                    maxValue: serviceField.maxValue,
                    decimalPlaces: serviceField.decimalPlaces,
                    minDecimal: serviceField.minDecimal,
                    maxDecimal: serviceField.maxDecimal,
                    isActive: serviceField.isActive,
                    audience: serviceField.audience,
                    conditionFieldId: serviceField.conditionFieldId,
                    conditionValue: serviceField.conditionValue,
                  }))}
                maxActive={MAX_ACTIVE_SERVICE_FIELDS}
                moveAction={moveServiceFieldAction}
                reactivateAction={reactivateServiceFieldAction}
                serviceId={service.id}
                updateAction={updateServiceFieldAction}
              />
              {/* SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3: only for services that require approval. */}
              {service.requiresApproval ? (
                <ServiceApprovalEditor
                  action={configureServiceApprovalAction}
                  conditionFields={approvalConditionChoices(serviceFields, service.id)}
                  current={{
                    sectorIds: service.approvalSectorIds ?? [],
                    conditionFieldId: service.approvalConditionFieldId ?? null,
                    conditionValue: service.approvalConditionValue ?? null,
                    deadlineDays: service.approvalDeadlineDays ?? null,
                  }}
                  sectors={approvalSectors}
                  serviceId={service.id}
                  serviceSectorId={service.sectorId}
                />
              ) : null}
              <ServiceStagesEditor
                createAction={createServiceStageAction}
                deactivateAction={deactivateServiceStageAction}
                maxActive={MAX_ACTIVE_SERVICE_STAGES}
                moveAction={moveServiceStageAction}
                reactivateAction={reactivateServiceStageAction}
                renameAction={renameServiceStageAction}
                serviceId={service.id}
                // SPEC 2026-11-06-aprofundamento-configurabilidade, 5.3.
                settingsAction={configureServiceStageAction}
                assigneeChoices={stageAssignees.filter((item) => item.sectorId === service.sectorId)}
                conditionChoices={approvalConditionChoices(serviceFields, service.id)}
                stages={serviceStages
                  .filter((stage) => stage.serviceId === service.id)
                  .map((stage) => ({
                    id: stage.id,
                    name: stage.name,
                    isActive: stage.isActive,
                    assigneeId: stage.assigneeId ?? null,
                    targetDays: stage.targetDays ?? null,
                    conditionFieldId: stage.conditionFieldId ?? null,
                    conditionValue: stage.conditionValue ?? null,
                  }))}
              />
            </AdminRecordEditor>
          ))}
        </ul>
        </section>
    </AdminSectionProvider>
  );
}
