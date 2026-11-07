import {
  isWithinValidity,
  receivablePermissions,
  validityLabel,
  type AccessRoleSummary,
  type PermissionRole,
  type RoleAssignmentRecord,
  type RoleEventRecord,
} from "@/modules/permissions";
import { PERMISSION_LABELS } from "@/shared/permissions";
import { ValidityInput, validityDay } from "./user-permissions-panel";

// Roles of one user (SPEC 2026-11-06-aprofundamento-configurabilidade, 6.3.1 to 6.3.3): the roles
// assigned, with their end and whether they count, the form to assign one and the history.

type RedirectAction = (formData: FormData) => Promise<never>;

type UserRolesPanelProps = {
  user: { id: string; role: PermissionRole; isActive: boolean };
  roles: AccessRoleSummary[];
  assignments: RoleAssignmentRecord[];
  history: RoleEventRecord[];
  today: string;
  assignAction: RedirectAction;
  removeAction: RedirectAction;
};

/** What an assignment gives this person now, or why it gives nothing. */
export function assignmentStatusText(
  user: Pick<UserRolesPanelProps["user"], "role">,
  role: Pick<AccessRoleSummary, "permissions" | "isActive">,
  expiresOn: string | null,
  today: string,
): { text: string; effective: boolean } {
  const validity = validityLabel(expiresOn, today);
  const parts: string[] = [];

  if (!role.isActive) {
    parts.push("papel inativo");
  } else if (!isWithinValidity(expiresOn, today)) {
    parts.push(validity ?? "");
  } else {
    const permissions = receivablePermissions(role, user);
    parts.push(permissions.length > 0 ? permissions.map((permission) => PERMISSION_LABELS[permission]).join(", ") : "sem efeito para o perfil");
    if (validity) parts.push(validity);
  }

  const effective = role.isActive && isWithinValidity(expiresOn, today) && receivablePermissions(role, user).length > 0;
  return { text: parts.join(" — "), effective };
}

/** "atribuído até 01/12/2026", "atribuído" or "retirado". */
export function roleEventText(event: Pick<RoleEventRecord, "action" | "expiresOn">): string {
  if (event.action === "REVOKED") return "retirado";
  return event.expiresOn ? `atribuído até ${validityDay(event.expiresOn)}` : "atribuído";
}

export function UserRolesPanel({ user, roles, assignments, history, today, assignAction, removeAction }: UserRolesPanelProps) {
  const byId = new Map(roles.map((role) => [role.id, role]));
  const held = new Set(assignments.map((assignment) => assignment.roleId));
  // Active roles the profile receives something from, and that the user does not hold yet.
  const assignable = roles.filter((role) => role.isActive && !held.has(role.id) && receivablePermissions(role, user).length > 0);

  if (assignments.length === 0 && history.length === 0 && (assignable.length === 0 || !user.isActive)) {
    return null;
  }

  return (
    <section aria-label="Papéis" className="requirements-panel">
      <h3>Papéis</h3>
      {assignments.length === 0 ? <p className="section-description">Nenhum papel atribuído.</p> : null}
      <ul className="requirement-list">
        {assignments.map((assignment) => {
          const role = byId.get(assignment.roleId);
          if (!role) return null;
          const status = assignmentStatusText(user, role, assignment.expiresOn, today);
          return (
            <li className="requirement-item" key={assignment.roleId}>
              <div className="entity-summary">
                <strong>{role.name}</strong>
                <span className={`status-badge${status.effective ? "" : " is-inactive"}`}>{status.text}</span>
              </div>
              <div className="entity-actions requirement-actions">
                {role.isActive && user.isActive ? (
                  <form action={assignAction} className="grant-form">
                    <input name="userId" type="hidden" value={user.id} />
                    <input name="roleId" type="hidden" value={role.id} />
                    <input name="section" type="hidden" value="users" />
                    <ValidityInput label="Válido até (opcional)" today={today} />
                    <button className="button-secondary" type="submit">
                      Renovar
                    </button>
                  </form>
                ) : null}
                <form action={removeAction}>
                  <input name="userId" type="hidden" value={user.id} />
                  <input name="roleId" type="hidden" value={role.id} />
                  <input name="section" type="hidden" value="users" />
                  <button className="button-danger" type="submit">
                    Retirar
                  </button>
                </form>
              </div>
            </li>
          );
        })}
      </ul>
      {user.isActive && assignable.length > 0 ? (
        <form action={assignAction} aria-label="Atribuir papel" className="create-form grant-form">
          <input name="userId" type="hidden" value={user.id} />
          <input name="section" type="hidden" value="users" />
          <label>
            Papel
            <select name="roleId" required>
              {assignable.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </label>
          <ValidityInput label="Válido até (opcional)" today={today} />
          <button type="submit">Atribuir papel</button>
        </form>
      ) : null}
      {history.length > 0 ? (
        <>
          <h4>Histórico de papéis</h4>
          <ul className="permission-history">
            {history.map((event) => (
              <li key={event.id}>
                {event.role.name}: {roleEventText(event)} por {event.actor.name} em{" "}
                <time dateTime={event.occurredAt.toISOString()}>{event.occurredAt.toLocaleString("pt-BR")}</time>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
