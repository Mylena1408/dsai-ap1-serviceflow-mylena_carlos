import Link from "next/link";
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ENTITY_LABELS,
  AUDIT_TRAIL_ENTITIES,
  describeAuditChange,
  type AuditTrail,
  type AuditTrailEntity,
  type AuditTrailItem,
  type AuditValue,
} from "@/modules/audit";
import { API_TOKEN_SCOPE_LABELS } from "@/modules/api-tokens";
import { WEBHOOK_EVENT_LABELS } from "@/modules/webhooks";
import { DISTRIBUTION_MODE_LABELS } from "@/modules/sectors";
import { FIELD_TYPE_LABELS, ROLE_LABELS } from "@/shared/admin-labels";
import {
  ANNOUNCEMENT_AUDIENCE_LABELS,
  ANNOUNCEMENT_KIND_LABELS,
  ANNOUNCEMENT_LEVEL_LABELS,
  formatAnnouncementInstant,
} from "@/modules/announcements";
import { ESCALATION_TRIGGER_LABELS, PRIORITY_LABELS } from "@/shared/requests";
import { PERIOD_ERRORS } from "@/app/_components/dashboard-view";
import { PERMISSION_LABELS } from "../../user-permissions-panel";

// "Auditoria" (SPEC 2026-11-02-auditoria-lgpd, 5.2): who changed what in the administration, most
// recent first. Records are read only; names of people are their current names.

const ENTITY_FILTER_LABELS: Record<AuditTrailEntity, string> = { ...AUDIT_ENTITY_LABELS, PERMISSION: "Permissão" };

function day(value: string): string {
  const [year, month, date] = value.split("-");
  return `${date}/${month}/${year}`;
}

/** Messages of refused filters; the section then shows the default period or every record. */
export function auditFilterMessages(errors: AuditTrail["errors"]): string[] {
  return [
    ...(errors.period ? [`${PERIOD_ERRORS[errors.period]} Mostrando os últimos 30 dias.`] : []),
    ...(errors.entity ? ["Tipo de registro desconhecido. Mostrando todos os tipos."] : []),
    ...(errors.actor ? ["Pessoa não encontrada na auditoria. Mostrando todas as pessoas."] : []),
  ];
}

/** Values people can read: sector and category names, profiles, priorities, field types, token scopes and dates. */
export function auditValueFormatter(names: Record<string, string>) {
  return (field: string, value: AuditValue): string | undefined => {
    // SPEC 2026-11-02-api-externa-webhooks, 5.7: the events of a webhook by their names.
    if (field === "eventTypes" && Array.isArray(value)) {
      return value.map((type) => (WEBHOOK_EVENT_LABELS as Record<string, string>)[type] ?? type).join(", ");
    }
    // SPEC 2026-11-03-api-acoes-webhooks-setor, 5.2: the sectors of a webhook by their names.
    if (field === "sectorIds" && Array.isArray(value)) {
      return value.length === 0 ? "Todos os setores" : value.map((id) => names[id] ?? "(removido)").join(", ");
    }
    // SPEC 2026-11-06-aprofundamento-configurabilidade, 6.3.1: the permissions of a role by their names.
    if (field === "permissions" && Array.isArray(value)) {
      return value.map((permission) => (PERMISSION_LABELS as Record<string, string>)[permission] ?? permission).join(", ");
    }
    // SPEC 2026-11-06-aprofundamento-configurabilidade, 7.4: the people an escalation rule warns.
    if (field === "notifyUserIds" && Array.isArray(value)) {
      return value.length === 0 ? "Ninguém" : value.map((id) => names[id] ?? "(removido)").join(", ");
    }
    if (field === "trigger" && typeof value === "string") {
      return ESCALATION_TRIGGER_LABELS[value as keyof typeof ESCALATION_TRIGGER_LABELS] ?? value;
    }
    if (field === "assignToId" && typeof value === "string") return names[value] ?? "(removido)";
    // SPEC 2026-11-07-operacao-e-automacao, 4.3 item 1.
    if (field === "distributionMode" && typeof value === "string") {
      return DISTRIBUTION_MODE_LABELS[value as keyof typeof DISTRIBUTION_MODE_LABELS] ?? value;
    }
    if (field === "maxActivePerAttendant") return value === null ? "Sem limite" : undefined;
    // SPEC 2026-11-07-operacao-e-automacao, 3.3 item 2: the services of a bundle, in order.
    if (field === "serviceIds" && Array.isArray(value)) return value.map((id) => names[id] ?? "(removido)").join(" → ");
    if (typeof value !== "string") return undefined;
    if (field === "sectorId" || field === "categoryId") return names[value] ?? "(removido)";
    if (field === "role") return ROLE_LABELS[value as keyof typeof ROLE_LABELS];
    if (field === "defaultPriority") return PRIORITY_LABELS[value as keyof typeof PRIORITY_LABELS];
    if (field === "type") return FIELD_TYPE_LABELS[value as keyof typeof FIELD_TYPE_LABELS];
    // SPEC 2026-11-02-api-externa-webhooks, 5.7: token scope and dates.
    if (field === "scope") return API_TOKEN_SCOPE_LABELS[value as keyof typeof API_TOKEN_SCOPE_LABELS];
    if (field === "expiresAt" || field === "revokedAt") return new Date(value).toLocaleString("pt-BR");
    // SPEC 2026-11-09-comunicacao-e-calendarios, 3.3 item 5: the announcement by names, its dates in the
    // organization's time zone and the sector of its audience by name.
    if (field === "level") return ANNOUNCEMENT_LEVEL_LABELS[value as keyof typeof ANNOUNCEMENT_LEVEL_LABELS] ?? value;
    if (field === "kind") return ANNOUNCEMENT_KIND_LABELS[value as keyof typeof ANNOUNCEMENT_KIND_LABELS] ?? value;
    if (field === "target") return ANNOUNCEMENT_AUDIENCE_LABELS[value as keyof typeof ANNOUNCEMENT_AUDIENCE_LABELS] ?? value;
    if (field === "targetRole") return ROLE_LABELS[value as keyof typeof ROLE_LABELS] ?? value;
    if (field === "targetSectorId") return names[value] ?? "(removido)";
    if (field === "startsAt" || field === "endsAt") return formatAnnouncementInstant(new Date(value));
    return undefined;
  };
}

/** "Alterou · Serviço · Reparo elétrico" or "Concedeu · Permissão · Gerir serviços do setor para Ana". */
export function auditItemTitle(item: AuditTrailItem): string {
  if (item.kind === "permission") {
    const action = item.action === "GRANTED" ? "Concedeu" : "Revogou";
    const until = item.action === "GRANTED" && item.expiresOn ? ` até ${day(item.expiresOn)}` : "";
    return `${action} · Permissão · ${PERMISSION_LABELS[item.permission]} para ${item.userName}${until}`;
  }

  return `${AUDIT_ACTION_LABELS[item.action]} · ${AUDIT_ENTITY_LABELS[item.entityType]} · ${item.entityLabel}`;
}

function actorText(item: AuditTrailItem): string {
  const name = item.actorName ?? "Pessoa não encontrada";
  return item.actorRole ? `${name} · ${ROLE_LABELS[item.actorRole]}` : name;
}

function pageHref(trail: AuditTrail, page: number): string {
  const params = new URLSearchParams({ section: "audit", period: trail.period.option });
  if (trail.period.option === "custom") {
    params.set("from", trail.period.firstDay);
    params.set("to", trail.period.lastDay);
  }
  // "type" in the URL: "entity" already belongs to the administration notices.
  if (trail.filters.entity) params.set("type", trail.filters.entity);
  if (trail.filters.actorId) params.set("actor", trail.filters.actorId);
  params.set("page", String(page));
  return `/admin?${params.toString()}`;
}

export function AuditSection({ trail }: { trail: AuditTrail }) {
  const format = auditValueFormatter(trail.names);
  const custom = trail.period.option === "custom";

  return (
    <section className="admin-section" aria-labelledby="audit-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Governança</p>
          <h2 id="audit-heading">Auditoria</h2>
          <p className="section-description">
            Quem criou, alterou, desativou ou reativou cadastros, e as permissões concedidas e revogadas. Nome e
            e-mail de pessoas aparecem só como &quot;alterado&quot;; senhas nunca são registradas.
          </p>
        </div>
      </div>

      <form method="get" action="/admin" className="dashboard-filters audit-filters" aria-label="Filtros da auditoria">
        <input type="hidden" name="section" value="audit" />
        <div className="search-field">
          <label htmlFor="audit-period">Período</label>
          <select id="audit-period" name="period" defaultValue={trail.period.option}>
            <option value="7">Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option>
            <option value="90">Últimos 90 dias</option>
            <option value="custom">Intervalo de datas</option>
          </select>
        </div>
        <div className="search-field">
          <label htmlFor="audit-from">De</label>
          <input id="audit-from" name="from" type="date" defaultValue={custom ? trail.period.firstDay : ""} />
        </div>
        <div className="search-field">
          <label htmlFor="audit-to">Até</label>
          <input id="audit-to" name="to" type="date" defaultValue={custom ? trail.period.lastDay : ""} />
        </div>
        <div className="search-field">
          <label htmlFor="audit-entity">Tipo</label>
          <select id="audit-entity" name="type" defaultValue={trail.filters.entity ?? ""}>
            <option value="">Todos</option>
            {AUDIT_TRAIL_ENTITIES.map((entity) => (
              <option key={entity} value={entity}>
                {ENTITY_FILTER_LABELS[entity]}
              </option>
            ))}
          </select>
        </div>
        <div className="search-field">
          <label htmlFor="audit-actor">Pessoa</label>
          <select id="audit-actor" name="actor" defaultValue={trail.filters.actorId ?? ""}>
            <option value="">Todas</option>
            {trail.actors.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit">Aplicar</button>
      </form>

      {auditFilterMessages(trail.errors).map((message) => (
        <p className="feedback feedback-error" role="alert" key={message}>
          {message}
        </p>
      ))}

      <p className="metadata">
        De {day(trail.period.firstDay)} a {day(trail.period.lastDay)} ·{" "}
        {trail.total === 1 ? "1 registro" : `${trail.total} registros`}
      </p>

      {trail.items.length === 0 ? (
        <p className="empty-state">Nenhum registro no período.</p>
      ) : (
        <ul className="entity-list audit-list">
          {trail.items.map((item) => (
            <li key={item.id}>
              <p>
                <strong>{auditItemTitle(item)}</strong>
              </p>
              <p className="metadata">
                <time dateTime={item.occurredAt.toISOString()}>{item.occurredAt.toLocaleString("pt-BR")}</time> ·{" "}
                {actorText(item)}
              </p>
              {item.kind === "change" && item.changes.length > 0 ? (
                <ul className="audit-changes">
                  {item.changes.map((change) => (
                    <li key={change.field}>{describeAuditChange(change, format)}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {trail.pageCount > 1 ? (
        <nav className="pagination" aria-label="Páginas da auditoria">
          {trail.page > 1 ? <Link href={pageHref(trail, trail.page - 1)}>Anterior</Link> : <span />}
          <p>
            Página {trail.page} de {trail.pageCount}
          </p>
          {trail.page < trail.pageCount ? <Link href={pageHref(trail, trail.page + 1)}>Próxima</Link> : <span />}
        </nav>
      ) : null}
    </section>
  );
}
