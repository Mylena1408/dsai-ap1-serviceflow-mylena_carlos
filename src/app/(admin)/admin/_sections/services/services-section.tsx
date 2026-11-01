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
import { ServiceSlaFields } from "../../service-sla-fields";
import {
  createDocumentRequirementAction,
  createServiceAction,
  createServiceFieldAction,
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
  section: "services";
  services: ServiceRecord[];
  categories: CategoryRecord[];
  sectors: SectorRecord[];
  documentRequirements: DocumentRequirementRecord[];
  serviceFields: ServiceFieldRecord[];
  serviceStages: ServiceStageRecord[];
};

export function ServicesSection({
  section,
  services,
  categories,
  sectors,
  documentRequirements,
  serviceFields,
  serviceStages,
}: ServicesSectionProps) {
  return (
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
          <ServiceSlaFields defaultPriority="NORMAL" slaHours={null} />
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
              }}
              categories={categories}
              sectors={sectors}
              section={section}
              toggleAction={toggleServiceAction}
              updateAction={updateServiceAction}
            >
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
                    isActive: serviceField.isActive,
                  }))}
                maxActive={MAX_ACTIVE_SERVICE_FIELDS}
                moveAction={moveServiceFieldAction}
                reactivateAction={reactivateServiceFieldAction}
                serviceId={service.id}
                updateAction={updateServiceFieldAction}
              />
              <ServiceStagesEditor
                createAction={createServiceStageAction}
                deactivateAction={deactivateServiceStageAction}
                maxActive={MAX_ACTIVE_SERVICE_STAGES}
                moveAction={moveServiceStageAction}
                reactivateAction={reactivateServiceStageAction}
                renameAction={renameServiceStageAction}
                serviceId={service.id}
                stages={serviceStages
                  .filter((stage) => stage.serviceId === service.id)
                  .map((stage) => ({ id: stage.id, name: stage.name, isActive: stage.isActive }))}
              />
            </AdminRecordEditor>
          ))}
        </ul>
        </section>
  );
}
