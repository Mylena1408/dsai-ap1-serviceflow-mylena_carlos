import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ValidationError } from "@/server/errors";
import type { AccessRoleSummary, RoleEventRecord } from "@/modules/permissions";
import {
  UserPermissionsPanel,
  grantStatusText,
  permissionEventText,
} from "@/app/(admin)/admin/user-permissions-panel";
import { UserRolesPanel, assignmentStatusText, roleEventText } from "@/app/(admin)/admin/user-roles-panel";
import {
  RolesSection,
  assignmentCountText,
  permissionHoldersText,
  rolePermissionsText,
} from "@/app/(admin)/admin/_sections/roles/roles-section";
import { auditItemTitle, auditValueFormatter } from "@/app/(admin)/admin/_sections/audit/audit-section";
import { announcement } from "@/app/(admin)/admin/_shared/announcement";
import { isValidityFailure } from "@/app/(admin)/admin/_shared/action-helpers";

// SPEC 2026-11-06-aprofundamento-configurabilidade, 6.3 (SF-172; CA-PAP-02, 04 and 05 on the screens).

const today = "2026-11-07";
const attendant = { id: "ana", role: "ATTENDANT" as const, isActive: true, sectorId: "s1" };
const noop = async (): Promise<never> => {
  throw new Error("not called");
};

const role = (overrides: Partial<AccessRoleSummary> = {}): AccessRoleSummary => ({
  id: "r1",
  name: "Supervisão",
  description: null,
  permissions: ["SECTOR_SERVICES", "QUEUE_SUPERVISION"],
  isActive: true,
  assignmentCount: 0,
  ...overrides,
});

const actor = { id: "admin", name: "Bruno" };
const at = new Date("2026-11-07T15:00:00Z");

describe("validity on the permissions panel (6.3.2)", () => {
  it("shows the end and whether the grant still counts", () => {
    expect(grantStatusText(attendant, "QUEUE_SUPERVISION", undefined, today)).toEqual({ text: "Não concedida", effective: false });
    expect(grantStatusText(attendant, "QUEUE_SUPERVISION", null, today)).toEqual({ text: "Concedida", effective: true });
    expect(grantStatusText(attendant, "QUEUE_SUPERVISION", "2026-12-01", today)).toEqual({
      text: "Concedida — vence em 01/12/2026",
      effective: true,
    });
    expect(grantStatusText(attendant, "QUEUE_SUPERVISION", "2026-11-06", today)).toEqual({
      text: "Concedida — vencida em 06/11/2026",
      effective: false,
    });
    expect(grantStatusText({ ...attendant, isActive: false }, "QUEUE_SUPERVISION", null, today)).toEqual({
      text: "Concedida — sem efeito",
      effective: false,
    });
  });

  it("writes the history with the end given", () => {
    expect(permissionEventText({ action: "GRANTED", expiresOn: "2026-12-01" })).toBe("concedida até 01/12/2026");
    expect(permissionEventText({ action: "GRANTED", expiresOn: null })).toBe("concedida");
    expect(permissionEventText({ action: "REVOKED", expiresOn: null })).toBe("revogada");
  });

  it("offers the date from today up to 365 days ahead, and renewing a grant", () => {
    const html = renderToStaticMarkup(
      createElement(UserPermissionsPanel, {
        user: attendant,
        grants: [{ permission: "QUEUE_SUPERVISION", expiresOn: "2026-11-06" }],
        history: [{ id: "e1", userId: "ana", permission: "QUEUE_SUPERVISION", action: "GRANTED", occurredAt: at, actor, expiresOn: "2026-11-06" }],
        today,
        grantAction: noop,
        revokeAction: noop,
      }),
    );
    expect(html).toContain('min="2026-11-07"');
    expect(html).toContain('max="2027-11-07"');
    expect(html).toContain("Concedida — vencida em 06/11/2026");
    expect(html).toContain(">Renovar<");
    expect(html).toContain(">Conceder<");
    expect(html).toContain("Supervisionar a fila do setor: concedida até 06/11/2026 por Bruno");
  });
});

describe("roles of a user (6.3.1 and 6.3.3)", () => {
  it("says what an assignment gives the profile, or why it gives nothing", () => {
    expect(assignmentStatusText(attendant, role(), null, today)).toEqual({
      text: "Gerir serviços do setor, Supervisionar a fila do setor",
      effective: true,
    });
    expect(assignmentStatusText({ role: "MANAGER" }, role(), "2026-11-30", today)).toEqual({
      text: "Gerir serviços do setor — vence em 30/11/2026",
      effective: true,
    });
    expect(assignmentStatusText(attendant, role(), "2026-11-01", today)).toEqual({ text: "vencida em 01/11/2026", effective: false });
    expect(assignmentStatusText(attendant, role({ isActive: false }), null, today)).toEqual({ text: "papel inativo", effective: false });
    expect(assignmentStatusText({ role: "MANAGER" }, role({ permissions: ["QUEUE_SUPERVISION"] }), null, today)).toEqual({
      text: "sem efeito para o perfil",
      effective: false,
    });
  });

  it("writes the role history with the end", () => {
    expect(roleEventText({ action: "GRANTED", expiresOn: "2026-12-01" })).toBe("atribuído até 01/12/2026");
    expect(roleEventText({ action: "GRANTED", expiresOn: null })).toBe("atribuído");
    expect(roleEventText({ action: "REVOKED", expiresOn: null })).toBe("retirado");
  });

  it("lists the assigned roles, offers only the active roles the profile can use, and shows the history", () => {
    const events: RoleEventRecord[] = [
      { id: "e1", userId: "ana", role: { id: "r1", name: "Supervisão" }, action: "GRANTED", occurredAt: at, actor, expiresOn: "2026-12-01" },
    ];
    const html = renderToStaticMarkup(
      createElement(UserRolesPanel, {
        user: { role: "MANAGER", id: "gabi", isActive: true },
        roles: [
          role(),
          role({ id: "r2", name: "Fila", permissions: ["QUEUE_SUPERVISION"] }),
          role({ id: "r3", name: "Antigo", isActive: false }),
          role({ id: "r4", name: "Leitura", permissions: ["SECTOR_REQUESTS_READ"] }),
        ],
        assignments: [{ userId: "gabi", roleId: "r1", assignedAt: at, expiresOn: "2026-12-01" }],
        history: events,
        today,
        assignAction: noop,
        removeAction: noop,
      }),
    );
    expect(html).toContain("Gerir serviços do setor — vence em 01/12/2026");
    expect(html).toContain(">Retirar<");
    expect(html).toContain('<option value="r4">Leitura</option>');
    expect(html).not.toContain('<option value="r2">');
    expect(html).not.toContain('<option value="r3">');
    expect(html).not.toContain('<option value="r1">');
    expect(html).toContain("Supervisão: atribuído até 01/12/2026 por Bruno");
  });

  it("shows nothing for a profile no role serves", () => {
    const html = renderToStaticMarkup(
      createElement(UserRolesPanel, {
        user: { role: "REQUESTER", id: "rita", isActive: true },
        roles: [role()],
        assignments: [],
        history: [],
        today,
        assignAction: noop,
        removeAction: noop,
      }),
    );
    expect(html).toBe("");
  });
});

describe("roles section (6.3.1)", () => {
  it("describes permissions, holders and counts", () => {
    expect(rolePermissionsText(["SECTOR_SERVICES"])).toBe("Gerir serviços do setor");
    expect(rolePermissionsText(["SECTOR_SERVICES", "SECTOR_REQUESTS_READ", "QUEUE_SUPERVISION"])).toBe(
      "Gerir serviços do setor, Ver todas as solicitações do setor e Supervisionar a fila do setor",
    );
    expect(permissionHoldersText("SECTOR_SERVICES")).toBe("Atendente, Gestor");
    expect(assignmentCountText(0)).toBe("Nenhum usuário");
    expect(assignmentCountText(1)).toBe("1 usuário");
    expect(assignmentCountText(4)).toBe("4 usuários");
  });

  it("lists roles with their state and the edit and activation forms", () => {
    const html = renderToStaticMarkup(
      createElement(RolesSection, { roles: [role({ assignmentCount: 2, description: "Turno" }), role({ id: "r2", name: "Antigo", isActive: false })] }),
    );
    expect(html).toContain("Criar papel");
    expect(html).toContain("Atribuído a: 2 usuários");
    expect(html).toContain("Turno");
    expect(html).toContain(">Desativar<");
    expect(html).toContain(">Reativar<");
    expect(html).toContain('aria-label="Editar papel Supervisão"');
    expect(renderToStaticMarkup(createElement(RolesSection, { roles: [] }))).toContain("Nenhum papel cadastrado.");
  });
});

describe("messages and audit (6.3.2 and 6.3.3)", () => {
  it("tells refused ends apart from other refusals", () => {
    expect(isValidityFailure(new ValidationError([{ path: ["expiresOn"], code: "too_small" }]))).toBe(true);
    expect(isValidityFailure(new ValidationError([{ path: ["permission"], code: "invalid_value" }]))).toBe(false);
    expect(isValidityFailure(new Error("x"))).toBe(false);
    expect(announcement("validation", undefined, "permissionValidity")).toContain("entre hoje e 365 dias");
    expect(announcement("validation", undefined, "roleValidity")).toContain("entre hoje e 365 dias");
    expect(announcement("validation", undefined, "roles")).toContain("de 1 a 3 permissões");
    expect(announcement("dependency", undefined, "roles")).toBe("Já existe um papel ativo com esse nome.");
    expect(announcement("validation", undefined, "roleAssignments")).toBe("Este perfil não recebe nenhuma permissão desse papel.");
    expect(announcement("dependency", undefined, "roleAssignments")).toContain("Só papéis ativos");
    expect(announcement(undefined, "created", "roles")).toBe("Papel criado.");
    expect(announcement(undefined, "updated", "roleAssignments")).toContain("Papéis do usuário atualizados");
  });

  it("shows the permissions of a role by name and the end of a grant", () => {
    const format = auditValueFormatter({});
    expect(format("permissions", ["SECTOR_SERVICES", "QUEUE_SUPERVISION"])).toBe("Gerir serviços do setor, Supervisionar a fila do setor");
    const item = {
      kind: "permission" as const,
      id: "p1",
      occurredAt: at,
      actorId: "admin",
      actorName: "Bruno",
      actorRole: "ADMIN" as const,
      action: "GRANTED" as const,
      permission: "QUEUE_SUPERVISION" as const,
      userName: "Ana",
      expiresOn: "2026-12-01",
    };
    expect(auditItemTitle(item)).toBe("Concedeu · Permissão · Supervisionar a fila do setor para Ana até 01/12/2026");
    expect(auditItemTitle({ ...item, action: "REVOKED" })).toBe("Revogou · Permissão · Supervisionar a fila do setor para Ana");
    expect(
      auditItemTitle({
        kind: "change",
        id: "c1",
        occurredAt: at,
        actorId: "admin",
        actorName: "Bruno",
        actorRole: "ADMIN",
        action: "CREATED",
        entityType: "ACCESS_ROLE",
        entityId: "r1",
        entityLabel: "Supervisão",
        changes: [],
      }),
    ).toBe("Criou · Papel de acesso · Supervisão");
  });
});
