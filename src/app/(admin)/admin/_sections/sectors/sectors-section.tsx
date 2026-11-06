import type { SectorRecord } from "@/modules/sectors";
import { AdminCreateForm } from "../../create-form";
import { AdminRecordEditor } from "../../record-editor";
import { createSectorAction, setSectorEscalationAction, toggleSectorAction, updateSectorAction } from "./actions";

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
        {/* SPEC 2026-11-06-escalonamento, 2.1: off by default; only the administrator changes it. */}
        <section className="surface-card" aria-labelledby="escalation-heading">
          <h3 id="escalation-heading">Escalar solicitações vencidas</h3>
          <p className="metadata">
            Quando uma solicitação vence sem ser concluída, a prioridade sobe um nível e os gestores do setor são avisados. O
            vencimento não muda.
          </p>
          <ul className="content-list">
            {sectors.map((sector) => (
              <li key={sector.id} className="escalation-row">
                <span>
                  {sector.name} · <strong>{sector.escalateOverdue ? "ligado" : "desligado"}</strong>
                </span>
                <form action={setSectorEscalationAction}>
                  <input type="hidden" name="section" value={section} />
                  <input type="hidden" name="id" value={sector.id} />
                  <input type="hidden" name="escalateOverdue" value={sector.escalateOverdue ? "false" : "true"} />
                  <button className="button-secondary" type="submit" aria-label={`${sector.escalateOverdue ? "Desligar" : "Ligar"} escalonamento de ${sector.name}`}>
                    {sector.escalateOverdue ? "Desligar" : "Ligar"}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
        </section>
  );
}
