import {
  MAX_ESCALATION_RULES,
  MAX_OVERDUE_DAYS,
  MAX_RULE_NAME_LENGTH,
  ruleEffectText,
  ruleTriggerText,
  type EscalationRuleRecord,
  type RuleChoice,
  type SectorRecord,
} from "@/modules/sectors";
import {
  createEscalationRuleAction,
  deleteEscalationRuleAction,
  toggleEscalationRuleAction,
  updateEscalationRuleAction,
} from "./actions";

// Escalation rules of each sector (SPEC 2026-11-06-aprofundamento-configurabilidade, 7.1 and 7.3),
// besides the "Escalar solicitações vencidas" option.

type RuleFormValues = Partial<EscalationRuleRecord>;

function RuleFields({ rule, people }: { rule?: RuleFormValues; people: RuleChoice[] }) {
  const attendants = people.filter((person) => person.role === "ATTENDANT");
  return (
    <>
      <label>
        Nome da regra
        <input defaultValue={rule?.name} maxLength={MAX_RULE_NAME_LENGTH} name="name" required />
      </label>
      <label>
        Quando
        <select defaultValue={rule?.trigger ?? "DUE_SOON"} name="trigger">
          <option value="DUE_SOON">Próxima do vencimento</option>
          <option value="OVERDUE_DAYS">Vencida há N dias</option>
        </select>
      </label>
      <label>
        N (dias de atraso, só para &quot;vencida há N dias&quot;)
        <input defaultValue={rule?.overdueDays ?? ""} max={MAX_OVERDUE_DAYS} min={1} name="overdueDays" type="number" />
      </label>
      <fieldset className="format-options">
        <legend>O que fazer</legend>
        <label className="checkbox-field">
          <input defaultChecked={rule?.raisePriority} name="raisePriority" type="checkbox" value="true" />
          Subir a prioridade um nível
        </label>
        <label>
          Atribuir a
          <select defaultValue={rule?.assignToId ?? ""} name="assignToId">
            <option value="">Ninguém</option>
            {attendants.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      <fieldset className="format-options">
        <legend>Quem avisar</legend>
        <label className="checkbox-field">
          <input defaultChecked={rule?.notifyManagers} name="notifyManagers" type="checkbox" value="true" />
          Gestores do setor
        </label>
        <label className="checkbox-field">
          <input defaultChecked={rule?.notifyTeam} name="notifyTeam" type="checkbox" value="true" />
          Equipe do setor
        </label>
        {people.map((person) => (
          <label className="checkbox-field" key={person.id}>
            <input defaultChecked={rule?.notifyUserIds?.includes(person.id)} name="notifyUserIds" type="checkbox" value={person.id} />
            {person.name} ({person.role === "MANAGER" ? "gestor" : "atendente"})
          </label>
        ))}
      </fieldset>
    </>
  );
}

export function EscalationRulesPanel({
  sector,
  rules,
  people,
  names,
}: {
  sector: Pick<SectorRecord, "id" | "name">;
  rules: EscalationRuleRecord[];
  /** Active attendants and managers of this sector. */
  people: RuleChoice[];
  /** Names of everyone a rule may mention. */
  names: Readonly<Record<string, string>>;
}) {
  const active = rules.filter((rule) => rule.isActive).length;

  return (
    <section aria-label={`Regras de escalonamento de ${sector.name}`} className="requirements-panel escalation-rules">
      <h4>{sector.name}</h4>
      {rules.length === 0 ? <p className="section-description">Nenhuma regra.</p> : null}
      <ul className="requirement-list">
        {rules.map((rule) => (
          <li className="requirement-item" key={rule.id}>
            <div className="entity-summary">
              <strong>{rule.name}</strong>
              <span className={`status-badge${rule.isActive ? "" : " is-inactive"}`}>{rule.isActive ? "Ativa" : "Inativa"}</span>
            </div>
            <p>
              {ruleTriggerText(rule)}: {ruleEffectText(rule, names)}
            </p>
            <details>
              <summary>Editar</summary>
              <form action={updateEscalationRuleAction} aria-label={`Editar regra ${rule.name}`} className="create-form escalation-rule-form">
                <input name="id" type="hidden" value={rule.id} />
                <RuleFields people={people} rule={rule} />
                <button type="submit">Salvar regra</button>
              </form>
            </details>
            <div className="entity-actions requirement-actions">
              <form action={toggleEscalationRuleAction}>
                <input name="id" type="hidden" value={rule.id} />
                <input name="isActive" type="hidden" value={rule.isActive ? "false" : "true"} />
                <button className="button-secondary" type="submit">
                  {rule.isActive ? "Desativar" : "Reativar"}
                </button>
              </form>
              <form action={deleteEscalationRuleAction}>
                <input name="id" type="hidden" value={rule.id} />
                <button className="button-danger" type="submit">
                  Apagar
                </button>
              </form>
            </div>
          </li>
        ))}
      </ul>
      {active < MAX_ESCALATION_RULES ? (
        <details>
          <summary>Nova regra</summary>
          <form action={createEscalationRuleAction} aria-label={`Nova regra de ${sector.name}`} className="create-form escalation-rule-form">
            <input name="sectorId" type="hidden" value={sector.id} />
            <RuleFields people={people} />
            <button type="submit">Criar regra</button>
          </form>
        </details>
      ) : (
        <p className="section-description">O setor já tem {MAX_ESCALATION_RULES} regras ativas.</p>
      )}
    </section>
  );
}
