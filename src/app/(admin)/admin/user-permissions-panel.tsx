import {
  PERMISSIONS,
  canReceivePermission,
  isPermissionEffective,
  type Permission,
  type PermissionEventRecord,
  type PermissionRole,
} from "@/modules/permissions";

// Permissions of one user (SPEC 2026-11-01-permissoes-configuraveis, 5.2 to 5.4).

type RedirectAction = (formData: FormData) => Promise<never>;

export const PERMISSION_LABELS: Record<Permission, string> = {
  SECTOR_SERVICES: "Gerir serviços do setor",
  SECTOR_REQUESTS_READ: "Ver todas as solicitações do setor",
  QUEUE_SUPERVISION: "Supervisionar a fila do setor",
};

type UserPermissionsPanelProps = {
  user: { id: string; role: PermissionRole; isActive: boolean; sectorId: string | null };
  granted: Permission[];
  history: PermissionEventRecord[];
  grantAction: RedirectAction;
  revokeAction: RedirectAction;
};

export function UserPermissionsPanel({ user, granted, history, grantAction, revokeAction }: UserPermissionsPanelProps) {
  // Permissions this profile may receive, plus granted ones that stopped counting (5.2.3).
  const shown = PERMISSIONS.filter((permission) => canReceivePermission(user.role, permission) || granted.includes(permission));

  if (shown.length === 0 && history.length === 0) {
    return null;
  }

  return (
    <section aria-label="Permissões adicionais" className="requirements-panel">
      <h3>Permissões adicionais</h3>
      <p className="section-description">Valem só no setor atual da pessoa.</p>
      <ul className="requirement-list">
        {shown.map((permission) => {
          const isGranted = granted.includes(permission);
          const effective = isGranted && isPermissionEffective(user, permission);
          return (
            <li className="requirement-item" key={permission}>
              <div className="entity-summary">
                <strong>{PERMISSION_LABELS[permission]}</strong>
                <span className={`status-badge${isGranted && !effective ? " is-inactive" : ""}`}>
                  {!isGranted ? "Não concedida" : effective ? "Concedida" : "Concedida — sem efeito"}
                </span>
              </div>
              <div className="entity-actions requirement-actions">
                <form action={isGranted ? revokeAction : grantAction}>
                  <input name="userId" type="hidden" value={user.id} />
                  <input name="permission" type="hidden" value={permission} />
                  <input name="section" type="hidden" value="users" />
                  <button className={isGranted ? "button-danger" : "button-secondary"} type="submit">
                    {isGranted ? "Revogar" : "Conceder"}
                  </button>
                </form>
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
                {PERMISSION_LABELS[event.permission]}: {event.action === "GRANTED" ? "concedida" : "revogada"} por{" "}
                {event.actor.name} em{" "}
                <time dateTime={event.occurredAt.toISOString()}>{event.occurredAt.toLocaleString("pt-BR")}</time>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
