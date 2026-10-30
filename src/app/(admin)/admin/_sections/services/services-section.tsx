import type { CategoryRecord } from "@/modules/categories";
import {
  MAX_ACTIVE_DOCUMENT_REQUIREMENTS,
  type DocumentRequirementRecord,
} from "@/modules/document-requirements";
import type { SectorRecord } from "@/modules/sectors";
import type { ServiceRecord } from "@/modules/services";
import { AdminCreateForm } from "../../create-form";
import { DocumentRequirementsEditor } from "../../document-requirements-editor";
import { AdminRecordEditor } from "../../record-editor";
import {
  createDocumentRequirementAction,
  createServiceAction,
  deactivateDocumentRequirementAction,
  moveDocumentRequirementAction,
  toggleServiceAction,
  updateDocumentRequirementAction,
  updateServiceAction,
} from "./actions";

type ServicesSectionProps = {
  section: "services";
  services: ServiceRecord[];
  categories: CategoryRecord[];
  sectors: SectorRecord[];
  documentRequirements: DocumentRequirementRecord[];
};

export function ServicesSection({
  section,
  services,
  categories,
  sectors,
  documentRequirements,
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
            </AdminRecordEditor>
          ))}
        </ul>
        </section>
  );
}
