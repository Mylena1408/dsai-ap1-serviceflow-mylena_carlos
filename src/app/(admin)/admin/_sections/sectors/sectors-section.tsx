import type { EscalationRuleOverview, SectorRecord } from "@/modules/sectors";
import { EscalationRulesPanel } from "./escalation-rules-panel";
import { AdminCreateForm } from "../../create-form";
import { AdminRecordEditor } from "../../record-editor";
import { createSectorAction, setSectorEscalationAction, toggleSectorAction, updateSectorAction } from "./actions";

type SectorsSectionProps = {
  section: "sectors";
  sectors: SectorRecord[];
  /** SPEC 2026-11-06-aprofundamento-configurabilidade, 7. */
  escalationRules: EscalationRuleOverview;
};

export function SectorsSection({ section, sectors, escalationRules }: SectorsSectionProps) {
  const names = Object.fromEntries(escalationRules.people.map((person) => [person.id, person.name]));
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
        {/* SPEC 2026-11-06-aprofundamento-configurabilidade, 7.3: up to 5 rules per sector. */}
        <section className="surface-card" aria-labelledby="escalation-rules-heading">
          <h3 id="escalation-rules-heading">Regras de escalonamento</h3>
          <p className="metadata">
            Além da opção acima, cada setor pode ter até 5 regras: quando a solicitação está próxima do vencimento ou vencida há N
            dias, subir a prioridade, atribuir a um atendente e avisar pessoas. Cada regra vale uma vez por solicitação e prazo, e
            nunca durante a pausa. O vencimento não muda.
          </p>
          {sectors
            .filter((sector) => sector.isActive)
            .map((sector) => (
              <EscalationRulesPanel
                key={sector.id}
                names={names}
                people={escalationRules.people.filter((person) => person.sectorId === sector.id)}
                rules={escalationRules.rules.filter((rule) => rule.sectorId === sector.id)}
                sector={sector}
              />
            ))}
        </section>
        </section>
  );
}
