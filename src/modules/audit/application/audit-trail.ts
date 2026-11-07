import { parseReportPeriod, type ReportPeriod, type ReportPeriodError } from "@/shared/periods";
import { requireConfigurationAdministrator } from "@/server/authorization";
import { entityIdSchema } from "@/shared/validation";
import { AUDIT_ENTITY_TYPES } from "../domain/audit";
import type { AuditTrailEntity, AuditTrailItem, AuditTrailReader } from "./ports";

// "Auditoria" section (SPEC 2026-11-02-auditoria-lgpd, 5.2): only the administrator, most recent
// first, 50 per page, filtered by period (the dashboard options), entity and person.

export const AUDIT_PAGE_SIZE = 50;
export const AUDIT_TRAIL_ENTITIES: readonly AuditTrailEntity[] = [...AUDIT_ENTITY_TYPES, "PERMISSION"];

type RawParams = Record<string, string | string[] | undefined>;

export interface AuditTrail {
  period: ReportPeriod;
  /** Refused filters are reported and ignored, like the dashboard does with the period. */
  errors: { period: ReportPeriodError | null; entity: "invalid_entity" | null; actor: "invalid_actor" | null };
  filters: { entity: AuditTrailEntity | null; actorId: string | null };
  actors: Array<{ id: string; name: string }>;
  items: AuditTrailItem[];
  total: number;
  page: number;
  pageCount: number;
  /** Names of the sectors and categories that appear in the changes, by id. */
  names: Record<string, string>;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function requestedPage(raw: string | undefined): number {
  return raw !== undefined && /^\d{1,6}$/.test(raw) && Number(raw) >= 1 ? Number(raw) : 1;
}

/** Ids of sectors and categories mentioned by the changes, so the screen can name them. */
function referencedIds(items: readonly AuditTrailItem[]): string[] {
  const ids = new Set<string>();

  for (const item of items) {
    if (item.kind !== "change") continue;
    for (const change of item.changes) {
      // People of an escalation rule (SPEC 2026-11-06-aprofundamento-configurabilidade, 7.4).
      if ("personal" in change || !["sectorId", "categoryId", "sectorIds", "assignToId", "notifyUserIds"].includes(change.field)) continue;
      // "sectorIds" of a webhook is a list (SPEC 2026-11-03-api-acoes-webhooks-setor, 5.2).
      for (const value of [change.before, change.after].flatMap((item) => (Array.isArray(item) ? item : [item]))) {
        if (typeof value === "string" && entityIdSchema.safeParse(value).success) ids.add(value);
      }
    }
  }

  return [...ids];
}

export async function listAuditTrail(raw: RawParams, reader: AuditTrailReader, now: Date): Promise<AuditTrail> {
  await requireConfigurationAdministrator();
  const { period, error } = parseReportPeriod(raw, now);
  const actors = await reader.actors();

  const entityRaw = single(raw.entity) || null;
  const entity = entityRaw !== null && AUDIT_TRAIL_ENTITIES.includes(entityRaw as AuditTrailEntity) ? (entityRaw as AuditTrailEntity) : null;
  const actorRaw = single(raw.actor) || null;
  const actorId = actorRaw !== null && actors.some((actor) => actor.id === actorRaw) ? actorRaw : null;

  const filter = { from: period.from, before: period.before, entity, actorId };
  const total = await reader.count(filter);
  const pageCount = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const page = Math.min(requestedPage(single(raw.page)), pageCount);
  const items = total === 0 ? [] : await reader.list(filter, (page - 1) * AUDIT_PAGE_SIZE, AUDIT_PAGE_SIZE);
  const ids = referencedIds(items);

  return {
    period,
    errors: {
      period: error,
      entity: entityRaw !== null && entity === null ? "invalid_entity" : null,
      actor: actorRaw !== null && actorId === null ? "invalid_actor" : null,
    },
    filters: { entity, actorId },
    actors,
    items,
    total,
    page,
    pageCount,
    names: ids.length === 0 ? {} : await reader.names(ids),
  };
}
