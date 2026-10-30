import type { SectorRecord } from "@/modules/sectors";
import { AdminCreateForm } from "../../create-form";
import { AdminRecordEditor } from "../../record-editor";
import { createSectorAction, toggleSectorAction, updateSectorAction } from "./actions";

type SectorsSectionProps = {
  section: "sectors";
  sectors: SectorRecord[];
};

export function SectorsSection({ section, sectors }: SectorsSectionProps) {
  return (
    <section className="admin-section" aria-labelledby="sectors-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Estrutura organizacional</p>
            <h2 id="sectors-heading">Setores</h2>
            <p className="section-description">Organize as equipes responsáveis pelo atendimento.</p>
          </div>
        </div>
        <AdminCreateForm action={createSectorAction} submitLabel="Criar setor">
          <label>
            Novo setor
            <input name="name" required maxLength={200} />
          </label>
        </AdminCreateForm>
        <ul className="entity-list">
          {sectors.map((sector) => (
            <AdminRecordEditor
              key={sector.id}
              record={{ kind: "sector", ...sector }}
              section={section}
              toggleAction={toggleSectorAction}
              updateAction={updateSectorAction}
            />
          ))}
        </ul>
        </section>
  );
}
