import {
  MAX_VALIDITY_DAYS,
  PERMISSIONS,
  canReceivePermission,
  isPermissionEffective,
  isWithinValidity,
  validityLabel,
  type Permission,
  type PermissionEventRecord,
  type PermissionGrantRecord,
  type PermissionRole,
} from "@/modules/permissions";
import { PERMISSION_LABELS } from "@/shared/permissions";
import { addDays } from "@/shared/time";

// Permissions of one user (SPEC 2026-11-01-permissoes-configuraveis, 5.2 to 5.4), with the end of
// each grant (SPEC 2026-11-06-aprofundamento-configurabilidade, 6.3.2).

type RedirectAction = (formData: FormData) => Promise<never>;

export { PERMISSION_LABELS };

type UserPermissionsPanelProps = {
  user: { id: string; role: PermissionRole; isActive: boolean; sectorId: string | null };
  grants: Array<Pick<PermissionGrantRecord, "permission" | "expiresOn">>;
  history: PermissionEventRecord[];
  today: string;
  grantAction: RedirectAction;
  revokeAction: RedirectAction;
};

/** "Concedida", "Concedida — vence em 01/12/2026", "Concedida — vencida em …" or "— sem efeito". */
export function grantStatusText(
  user: UserPermissionsPanelProps["user"],
  permission: Permission,
  expiresOn: string | null | undefined,
  today: string,
): { text: string; effective: boolean } {
  if (expiresOn === undefined) {
    return { text: "Não concedida", effective: false };
  }

  const validity = validityLabel(expiresOn, today);
  const effective = isPermissionEffective(user, permission) && isWithinValidity(expiresOn, today);
  const suffix = [validity, isPermissionEffective(user, permission) ? null : "sem efeito"].filter(Boolean).join(", ");
  return { text: suffix ? `Concedida — ${suffix}` : "Concedida", effective };
}

/** "concedida até 01/12/2026 por Bruno em …" or "revogada por …". */
export function permissionEventText(event: Pick<PermissionEventRecord, "action" | "expiresOn">): string {
  if (event.action === "REVOKED") return "revogada";
  return event.expiresOn ? `concedida até ${validityDay(event.expiresOn)}` : "concedida";
}

export function validityDay(day: string): string {
  const [year, month, date] = day.split("-");
  return `${date}/${month}/${year}`;
}

/** The optional end of a grant or assignment, from today up to 365 days ahead. */
export function ValidityInput({ today, label = "Válida até (opcional)" }: { today: string; label?: string }) {
  return (
    <label>
      {label}
      <input max={addDays(today, MAX_VALIDITY_DAYS)} min={today} name="expiresOn" type="date" />
    </label>
  );
}

export function UserPermissionsPanel({ user, grants, history, today, grantAction, revokeAction }: UserPermissionsPanelProps) {
  const ends = new Map(grants.map((grant) => [grant.permission, grant.expiresOn]));
  // Permissions this profile may receive, plus granted ones that stopped counting (5.2.3).
  const shown = PERMISSIONS.filter((permission) => canReceivePermission(user.role, permission) || ends.has(permission));

  if (shown.length === 0 && history.length === 0) {
    return null;
  }

  return (
    <section aria-label="Permissões adicionais" className="requirements-panel">
      <h3>Permissões adicionais</h3>
      <p className="section-description">Valem só no setor atual da pessoa e, com data de fim, até o fim desse dia.</p>
      <ul className="requirement-list">
        {shown.map((permission) => {
          const isGranted = ends.has(permission);
          const status = grantStatusText(user, permission, ends.get(permission), today);
          return (
            <li className="requirement-item" key={permission}>
              <div className="entity-summary">
                <strong>{PERMISSION_LABELS[permission]}</strong>
                <span className={`status-badge${isGranted && !status.effective ? " is-inactive" : ""}`}>{status.text}</span>
              </div>
              <div className="entity-actions requirement-actions">
                {canReceivePermission(user.role, permission) ? (
                  <form action={grantAction} className="grant-form">
                    <input name="userId" type="hidden" value={user.id} />
                    <input name="permission" type="hidden" value={permission} />
                    <input name="section" type="hidden" value="users" />
                    <ValidityInput today={today} />
                    <button className="button-secondary" type="submit">
                      {isGranted ? "Renovar" : "Conceder"}
                    </button>
                  </form>
                ) : null}
                {isGranted ? (
                  <form action={revokeAction}>
                    <input name="userId" type="hidden" value={user.id} />
                    <input name="permission" type="hidden" value={permission} />
                    <input name="section" type="hidden" value="users" />
                    <button className="button-danger" type="submit">
                      Revogar
                    </button>
                  </form>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {history.length > 0 ? (
        <>
          <h4>Histórico</h4>
          <ul className="permission-history">
            {history.map((event) => (
              <li key={event.id}>
                {PERMISSION_LABELS[event.permission]}: {permissionEventText(event)} por {event.actor.name} em{" "}
                <time dateTime={event.occurredAt.toISOString()}>{event.occurredAt.toLocaleString("pt-BR")}</time>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
