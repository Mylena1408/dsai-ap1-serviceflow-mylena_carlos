import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AuditTrail } from "@/modules/audit";

// The module entry points load the session; the section only needs pure rules.
vi.mock("@/modules/audit", async () => {
  const audit = await import("@/modules/audit/domain/audit");
  return { ...audit, AUDIT_TRAIL_ENTITIES: [...audit.AUDIT_ENTITY_TYPES, "PERMISSION"] };
});
vi.mock("@/modules/permissions", async () => import("@/shared/permissions"));
vi.mock("@/modules/api-tokens", async () => import("@/modules/api-tokens/domain/token"));
vi.mock("@/modules/webhooks", async () => import("@/modules/webhooks/domain/delivery"));
vi.mock("@/modules/reports", async () => {
  const { barPercentage } = await import("@/modules/reports/domain/metrics");
  return { barPercentage };
});

import {
  AuditSection,
  auditFilterMessages,
  auditItemTitle,
  auditValueFormatter,
} from "@/app/(admin)/admin/_sections/audit/audit-section";
import { lastDaysPeriod } from "@/shared/periods";

// SPEC 2026-11-02-auditoria-lgpd, 5.2 (SF-104; CA-AUD-03 and CA-AUD-04).

const now = new Date("2026-11-02T15:00:00.000Z");
const sector = "11111111-1111-4111-8111-111111111111";

const trail: AuditTrail = {
  period: lastDaysPeriod(30, now),
  errors: { period: null, entity: null, actor: null },
  filters: { entity: null, actorId: null },
  actors: [{ id: "admin-1", name: "Ana Lima" }],
  items: [
    {
      kind: "change",
      id: "e1",
      occurredAt: new Date("2026-11-01T12:00:00.000Z"),
      actorId: "admin-1",
      actorName: "Ana Lima",
      actorRole: "ADMIN",
      action: "UPDATED",
      entityType: "USER",
      entityId: "u1",
      entityLabel: "Carla Mendes",
      changes: [
        { field: "email", personal: true },
        { field: "role", before: "REQUESTER", after: "ATTENDANT" },
        { field: "sectorId", before: null, after: sector },
      ],
    },
    {
      kind: "permission",
      id: "p1",
      occurredAt: new Date("2026-11-01T11:00:00.000Z"),
      actorId: "admin-1",
      actorName: "Ana Lima",
      actorRole: "ADMIN",
      action: "GRANTED",
      permission: "SECTOR_SERVICES",
      userName: "Diego Rocha",
      expiresOn: null,
    },
  ],
  total: 2,
  page: 1,
  pageCount: 1,
  names: { [sector]: "Infraestrutura" },
};

const render = (value: AuditTrail) => renderToStaticMarkup(createElement(AuditSection, { trail: value }));

describe("audit section (SF-104; CA-AUD-04)", () => {
  it("shows who changed what, with readable values and personal fields only as changed", () => {
    const html = render(trail);

    expect(html).toContain("<strong>Alterou · Usuário · Carla Mendes</strong>");
    expect(html).toContain("Ana Lima · Administrador");
    expect(html).toContain("<li>E-mail: alterado</li>");
    expect(html).toContain("<li>Perfil: Solicitante → Atendente</li>");
    expect(html).toContain("<li>Setor: — → Infraestrutura</li>");
    expect(html).toContain("<strong>Concedeu · Permissão · Gerir serviços do setor para Diego Rocha</strong>");
    expect(html).toContain("De 04/10/2026 a 02/11/2026 · 2 registros");
  });

  it("filters by period, type (permissions included) and person in the URL", () => {
    const html = render(trail);

    expect(html).toContain('<input type="hidden" name="section" value="audit"/>');
    expect(html).toContain('<option value="PERMISSION">Permissão</option>');
    expect(html).toContain('<option value="SERVICE">Serviço</option>');
    expect(html).toContain('<option value="admin-1">Ana Lima</option>');
    expect(html).toContain('name="type"');
  });

  it("pages keeping the filters", () => {
    const html = render({
      ...trail,
      filters: { entity: "SERVICE", actorId: "admin-1" },
      page: 2,
      pageCount: 3,
    });

    expect(html).toContain('href="/admin?section=audit&amp;period=30&amp;type=SERVICE&amp;actor=admin-1&amp;page=1"');
    expect(html).toContain('href="/admin?section=audit&amp;period=30&amp;type=SERVICE&amp;actor=admin-1&amp;page=3"');
    expect(html).toContain("Página 2 de 3");
  });

  it("says when there is nothing in the period", () => {
    expect(render({ ...trail, items: [], total: 0 })).toContain("Nenhum registro no período.");
  });
});

describe("texts of the audit section", () => {
  it("formats sectors, categories, profiles, priorities and field types", () => {
    const format = auditValueFormatter({ [sector]: "Infraestrutura" });

    expect(format("sectorId", sector)).toBe("Infraestrutura");
    expect(format("categoryId", "99999999-9999-4999-8999-999999999999")).toBe("(removido)");
    expect(format("role", "MANAGER")).toBe("Gestor");
    expect(format("defaultPriority", "URGENT")).toBe("Urgente");
    expect(format("type", "SELECT")).toBe("Lista de opções");
    expect(format("name", "Reparo")).toBeUndefined();
    expect(format("slaHours", 24)).toBeUndefined();
  });

  // SPEC 2026-11-02-api-externa-webhooks, 5.7 (SF-112).
  it("formats the scope and the dates of an API token", () => {
    const format = auditValueFormatter({});

    expect(format("scope", "WRITE")).toBe("Leitura e escrita");
    expect(format("expiresAt", "2026-12-02T15:00:00.000Z")).toBe(new Date("2026-12-02T15:00:00.000Z").toLocaleString("pt-BR"));
    expect(format("revokedAt", "2026-11-02T15:00:00.000Z")).not.toContain("T15:00");
  });

  it("titles every kind of record", () => {
    const [changeItem, permissionItem] = trail.items;
    expect(auditItemTitle({ ...permissionItem, action: "REVOKED" } as typeof permissionItem)).toBe(
      "Revogou · Permissão · Gerir serviços do setor para Diego Rocha",
    );
    expect(auditItemTitle({ ...changeItem, action: "REORDERED", entityType: "SERVICE_STAGE", entityLabel: "Triagem" } as typeof changeItem)).toBe(
      "Reordenou · Etapa · Triagem",
    );
  });

  it("explains refused filters", () => {
    expect(auditFilterMessages({ period: "too_long", entity: "invalid_entity", actor: "invalid_actor" })).toEqual([
      "O intervalo pode ter no máximo 366 dias. Mostrando os últimos 30 dias.",
      "Tipo de registro desconhecido. Mostrando todos os tipos.",
      "Pessoa não encontrada na auditoria. Mostrando todas as pessoas.",
    ]);
  });
});
