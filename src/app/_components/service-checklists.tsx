import {
  MAX_ACTIVE_CHECKLIST_ITEMS,
  MAX_CHECKLIST_TEXT_LENGTH,
  type ChecklistConditionField,
  type ChecklistTemplateItem,
  type ServiceChecklist,
} from "@/modules/checklists";
import {
  copyChecklistModelAction,
  createChecklistItemAction,
  moveChecklistItemAction,
  setChecklistItemActiveAction,
  setChecklistItemConditionAction,
  updateChecklistItemAction,
} from "./service-checklist-actions";

// The services' checklist models (SPEC 2026-11-08-atendimento-dia-a-dia, 4.1 item 1 and 4.3 item 1), shared by
// the administration (every service) and the manager's area (their sector's services): add items, change them,
// move them up and down, deactivate and reactivate them.

const MESSAGES: Record<string, { text: string; error: boolean }> = {
  "checklist-created": { text: "Item acrescentado ao checklist.", error: false },
  "checklist-updated": { text: "Item alterado.", error: false },
  "checklist-moved": { text: "Ordem alterada.", error: false },
  "checklist-deactivated": { text: "Item desativado. Os checklists já copiados para solicitações não mudam.", error: false },
  "checklist-reactivated": { text: "Item reativado, no fim da lista.", error: false },
  "checklist-limit": { text: `O serviço já tem ${MAX_ACTIVE_CHECKLIST_ITEMS} itens ativos. Desative algum antes.`, error: true },
  "checklist-invalid": { text: `Escreva o item com 1 a ${MAX_CHECKLIST_TEXT_LENGTH} caracteres.`, error: true },
  "checklist-conflict": { text: "Só itens ativos mudam de ordem, e um item só é reativado com o campo da sua condição ativo.", error: true },
  "checklist-missing": { text: "O serviço ou o item não está disponível para você.", error: true },
  // SPEC 2026-11-08-atendimento-dia-a-dia, 13.1 item 1.
  // 13.1 item 2.
  "checklist-copied": { text: "Itens copiados para o fim do checklist, sem as condições.", error: false },
  "checklist-source": { text: "Escolha outro serviço, com itens ativos, que você também configura.", error: true },
  "checklist-condition-saved": { text: "Condição do item salva. Vale para as solicitações que entrarem em atendimento daqui em diante.", error: false },
  "checklist-condition": {
    text: "Escolha um campo ativo do formulário do solicitante, de escolha e sem condição própria, e um dos seus valores.",
    error: true,
  },
};

export function serviceChecklistMessage(code: string | undefined): { text: string; error: boolean } | null {
  return code ? (MESSAGES[code] ?? null) : null;
}

function RequiredSelect({ defaultValue }: { defaultValue: boolean }) {
  return (
    <select defaultValue={defaultValue ? "true" : "false"} name="isRequired">
      <option value="true">Obrigatório</option>
      <option value="false">Opcional</option>
    </select>
  );
}

/** How a value reads: yes or no for that kind of field, the option itself otherwise. */
function valueLabel(value: string, isYesNo: boolean): string {
  if (!isYesNo) return value;
  return value === "true" ? "Sim" : "Não";
}

/** 13.1 item 1: "Sempre", or "Quando Equipamento for Notebook". */
export function conditionText(
  item: Pick<ChecklistTemplateItem, "conditionFieldId" | "conditionValue">,
  fields: readonly ChecklistConditionField[],
  labels: Readonly<Record<string, string>>,
): string {
  if (item.conditionFieldId === null || item.conditionValue === null) return "Sempre";
  const field = fields.find(({ id }) => id === item.conditionFieldId);
  const label = field?.label ?? labels[item.conditionFieldId] ?? "campo removido";
  return `Quando "${label}" for "${valueLabel(item.conditionValue, field?.isYesNo ?? false)}"`;
}

function ConditionSelect({ item, fields }: { item: ChecklistTemplateItem; fields: readonly ChecklistConditionField[] }) {
  const current = item.conditionFieldId && item.conditionValue !== null ? `${item.conditionFieldId}|${item.conditionValue}` : "";
  return (
    <select defaultValue={current} name="condition">
      <option value="">Sempre</option>
      {fields.flatMap((field) =>
        field.values.map((value) => (
          <option key={`${field.id}|${value}`} value={`${field.id}|${value}`}>
            Quando &quot;{field.label}&quot; for &quot;{valueLabel(value, field.isYesNo)}&quot;
          </option>
        )),
      )}
    </select>
  );
}

/** 13.1 item 2: the other services on the screen with active items, as copy sources. */
function sources(services: readonly ServiceChecklist[], serviceId: string) {
  return services
    .filter(({ service }) => service.id !== serviceId)
    .map(({ service, items }) => ({ service, activeItems: items.filter((item) => item.isActive).length }))
    .filter(({ activeItems }) => activeItems > 0);
}

function Hidden({ area, serviceId }: { area: "approvals" | "admin"; serviceId: string }) {
  return (
    <>
      <input name="area" type="hidden" value={area} />
      <input name="serviceId" type="hidden" value={serviceId} />
    </>
  );
}

export function ServiceChecklistsPanel({
  services,
  area,
  message,
  open,
}: {
  services: ServiceChecklist[];
  area: "approvals" | "admin";
  message?: string;
  /** The service whose block starts open (the one just changed). */
  open?: string;
}) {
  const feedback = serviceChecklistMessage(message);

  return (
    <section className="surface-card content-section" aria-labelledby="service-checklists-heading">
      <h2 id="service-checklists-heading">Checklists dos serviços</h2>
      <p className="section-description">
        O checklist é copiado para a solicitação quando ela entra em atendimento. Mudar o modelo não altera os checklists já copiados. Só a equipe vê; o
        solicitante não. Até {MAX_ACTIVE_CHECKLIST_ITEMS} itens ativos por serviço.
      </p>
      {feedback ? (
        <p className={`feedback${feedback.error ? " feedback-error" : ""}`} role={feedback.error ? "alert" : "status"}>
          {feedback.text}
        </p>
      ) : null}
      {services.length === 0 ? <p>Nenhum serviço ativo.</p> : null}
      {services.map(({ service, items, conditionFields, fieldLabels }) => {
        const active = items.filter((item) => item.isActive);
        return (
          <details className="service-checklist" key={service.id} open={open === service.id}>
            <summary>
              {service.name} ({service.sectorName}) — {active.length === 1 ? "1 item ativo" : `${active.length} itens ativos`}
            </summary>
            {items.length === 0 ? (
              <p className="section-description">Sem checklist: as solicitações deste serviço seguem como hoje.</p>
            ) : (
              <table className="data-table">
                <caption>Checklist de {service.name}</caption>
                <thead>
                  <tr>
                    <th scope="col">Ordem</th>
                    <th scope="col">Item</th>
                    <th scope="col">Tipo</th>
                    <th scope="col">Aplica-se</th>
                    <th scope="col">Situação</th>
                    <th scope="col">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const index = active.findIndex(({ id }) => id === item.id);
                    return (
                      <tr key={item.id}>
                        <td>{item.isActive ? index + 1 : "—"}</td>
                        <td>{item.text}</td>
                        <td>{item.isRequired ? "Obrigatório" : "Opcional"}</td>
                        <td>{conditionText(item, conditionFields, fieldLabels)}</td>
                        <td>{item.isActive ? "Ativo" : "Inativo"}</td>
                        <td>
                          <details>
                            <summary>Alterar</summary>
                            <form action={updateChecklistItemAction} aria-label={`Alterar o item ${item.text}`} className="inline-form">
                              <Hidden area={area} serviceId={service.id} />
                              <input name="itemId" type="hidden" value={item.id} />
                              <label>
                                Texto
                                <input defaultValue={item.text} maxLength={MAX_CHECKLIST_TEXT_LENGTH} name="text" required />
                              </label>
                              <label>
                                Tipo
                                <RequiredSelect defaultValue={item.isRequired} />
                              </label>
                              <button type="submit">Salvar</button>
                            </form>
                            {/* SPEC 2026-11-08-atendimento-dia-a-dia, 13.1 item 1 (decision J1). */}
                            <form action={setChecklistItemConditionAction} aria-label={`Condição do item ${item.text}`} className="inline-form">
                              <Hidden area={area} serviceId={service.id} />
                              <input name="itemId" type="hidden" value={item.id} />
                              <label>
                                Aplica-se
                                <ConditionSelect fields={conditionFields} item={item} />
                              </label>
                              <button type="submit">Salvar condição</button>
                            </form>
                          </details>
                          {item.isActive && index > 0 ? (
                            <form action={moveChecklistItemAction}>
                              <Hidden area={area} serviceId={service.id} />
                              <input name="itemId" type="hidden" value={item.id} />
                              <input name="direction" type="hidden" value="up" />
                              <button aria-label={`Subir ${item.text}`} className="button-secondary" type="submit">
                                Subir
                              </button>
                            </form>
                          ) : null}
                          {item.isActive && index < active.length - 1 ? (
                            <form action={moveChecklistItemAction}>
                              <Hidden area={area} serviceId={service.id} />
                              <input name="itemId" type="hidden" value={item.id} />
                              <input name="direction" type="hidden" value="down" />
                              <button aria-label={`Descer ${item.text}`} className="button-secondary" type="submit">
                                Descer
                              </button>
                            </form>
                          ) : null}
                          <form action={setChecklistItemActiveAction}>
                            <Hidden area={area} serviceId={service.id} />
                            <input name="itemId" type="hidden" value={item.id} />
                            <input name="isActive" type="hidden" value={item.isActive ? "false" : "true"} />
                            <button aria-label={`${item.isActive ? "Desativar" : "Reativar"} ${item.text}`} className="button-secondary" type="submit">
                              {item.isActive ? "Desativar" : "Reativar"}
                            </button>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {active.length < MAX_ACTIVE_CHECKLIST_ITEMS ? (
              <form action={createChecklistItemAction} aria-label={`Novo item do checklist de ${service.name}`} className="inline-form">
                <Hidden area={area} serviceId={service.id} />
                <label>
                  Novo item
                  <input maxLength={MAX_CHECKLIST_TEXT_LENGTH} name="text" required />
                </label>
                <label>
                  Tipo
                  <RequiredSelect defaultValue={true} />
                </label>
                <button type="submit">Acrescentar item</button>
              </form>
            ) : (
              <p className="section-description">Limite de {MAX_ACTIVE_CHECKLIST_ITEMS} itens ativos atingido.</p>
            )}
            {/* SPEC 2026-11-08-atendimento-dia-a-dia, 13.1 item 2 (decision J2). */}
            {sources(services, service.id).length > 0 && active.length < MAX_ACTIVE_CHECKLIST_ITEMS ? (
              <form action={copyChecklistModelAction} aria-label={`Copiar para ${service.name}`} className="inline-form">
                <Hidden area={area} serviceId={service.id} />
                <label>
                  Copiar de outro serviço
                  <select name="sourceServiceId" required>
                    {sources(services, service.id).map((source) => (
                      <option key={source.service.id} value={source.service.id}>
                        {source.service.name} ({source.service.sectorName}) — {source.activeItems === 1 ? "1 item" : `${source.activeItems} itens`}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="button-secondary" type="submit">
                  Copiar itens
                </button>
              </form>
            ) : null}
          </details>
        );
      })}
    </section>
  );
}
