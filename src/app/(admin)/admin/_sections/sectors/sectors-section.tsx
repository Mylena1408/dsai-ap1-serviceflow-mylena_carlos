import { DISTRIBUTION_MODE_LABELS, MAX_ACTIVE_LIMIT, MIN_ACTIVE_LIMIT, SECTOR_DISTRIBUTION_MODES, distributionSummary, type EscalationRuleOverview, type SectorRecord } from "@/modules/sectors";
import type { SectorLoad } from "@/modules/requests";
import { TeamLoad } from "@/app/_components/team-load";
import { EscalationRulesPanel } from "./escalation-rules-panel";
import { AdminCreateForm } from "../../create-form";
import { AdminRecordEditor } from "../../record-editor";
import { createSectorAction, setSectorDistributionAction, setSectorEscalationAction, toggleSectorAction, updateSectorAction } from "./actions";

type SectorsSectionProps = {
  section: "sectors";
  sectors: SectorRecord[];
  /** SPEC 2026-11-06-aprofundamento-configurabilidade, 7. */
  escalationRules: EscalationRuleOverview;
  /** SPEC 2026-11-07-operacao-e-automacao, 4.3 item 8: every sector's load. */
  teamLoad: SectorLoad[] | null;
};

export function SectorsSection({ section, sectors, escalationRules, teamLoad }: SectorsSectionProps) {
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
        {/* SPEC 2026-11-07-operacao-e-automacao, 4.3 item 1: off by default; only the administrator changes it. */}
        <section className="surface-card" aria-labelledby="distribution-heading">
          <h3 id="distribution-heading">Distribuição automática</h3>
          <p className="metadata">
            Com a distribuição ligada, a solicitação que entra na fila sem responsável vai para um atendente do setor: no rodízio, o
            próximo pelo nome; na menor carga, quem tem menos solicitações ativas. Quem está inativo, ausente ou no limite é pulado.
          </p>
          <ul className="content-list">
            {sectors
              .filter((sector) => sector.isActive)
              .map((sector) => {
                const settings = {
                  distributionMode: sector.distributionMode ?? "NONE",
                  maxActivePerAttendant: sector.maxActivePerAttendant ?? null,
                  redistributeOnAbsence: sector.redistributeOnAbsence ?? false,
                };
                return (
                  <li key={sector.id} className="distribution-row">
                    <p>
                      {sector.name} · <strong>{distributionSummary(settings)}</strong>
                    </p>
                    <form action={setSectorDistributionAction} aria-label={`Distribuição de ${sector.name}`} className="create-form">
                      <input type="hidden" name="id" value={sector.id} />
                      <label>
                        Modo
                        <select defaultValue={settings.distributionMode} name="distributionMode">
                          {SECTOR_DISTRIBUTION_MODES.map((mode) => (
                            <option key={mode} value={mode}>
                              {DISTRIBUTION_MODE_LABELS[mode]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Limite por atendente (vazio = sem limite)
                        <input defaultValue={settings.maxActivePerAttendant ?? ""} max={MAX_ACTIVE_LIMIT} min={MIN_ACTIVE_LIMIT} name="maxActivePerAttendant" type="number" />
                      </label>
                      <label className="checkbox-field">
                        <input defaultChecked={settings.redistributeOnAbsence} name="redistributeOnAbsence" type="checkbox" value="true" />
                        Passar as solicitações de quem se ausenta
                      </label>
                      <button className="button-secondary" type="submit">
                        Salvar distribuição
                      </button>
                    </form>
                  </li>
                );
              })}
          </ul>
        </section>
        <TeamLoad loads={teamLoad} />
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
