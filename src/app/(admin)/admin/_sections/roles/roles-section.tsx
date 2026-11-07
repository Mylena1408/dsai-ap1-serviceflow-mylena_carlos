import {
  MAX_ROLE_DESCRIPTION_LENGTH,
  MAX_ROLE_NAME_LENGTH,
  MAX_ROLE_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_HOLDERS,
  type AccessRoleSummary,
  type Permission,
} from "@/modules/permissions";
import { ROLE_LABELS } from "@/shared/admin-labels";
import { PERMISSION_LABELS } from "@/shared/permissions";
import { createRoleAction, toggleRoleAction, updateRoleAction } from "./actions";

// "Papéis" (SPEC 2026-11-06-aprofundamento-configurabilidade, 6.3.1): a name and a set of the
// existing permissions, assigned to users in "Usuários". A deactivated role stops counting for
// everyone and keeps its assignments.

/** "Gestor, Atendente": who may receive a permission (table 5.1). */
export function permissionHoldersText(permission: Permission): string {
  return PERMISSION_HOLDERS[permission].map((role) => ROLE_LABELS[role]).join(", ");
}

/** "Gerir serviços do setor e Supervisionar a fila do setor". */
export function rolePermissionsText(permissions: readonly Permission[]): string {
  const labels = permissions.map((permission) => PERMISSION_LABELS[permission]);
  return labels.length <= 1 ? (labels[0] ?? "") : `${labels.slice(0, -1).join(", ")} e ${labels.at(-1)}`;
}

/** "Nenhum usuário", "1 usuário", "3 usuários". */
export function assignmentCountText(count: number): string {
  if (count === 0) return "Nenhum usuário";
  return count === 1 ? "1 usuário" : `${count} usuários`;
}

function RoleFields({ role }: { role?: AccessRoleSummary }) {
  return (
    <>
      <label>
        Nome
        <input defaultValue={role?.name} maxLength={MAX_ROLE_NAME_LENGTH} name="name" required />
      </label>
      <label>
        Descrição (opcional)
        <input defaultValue={role?.description ?? ""} maxLength={MAX_ROLE_DESCRIPTION_LENGTH} name="description" />
      </label>
      <fieldset className="format-options">
        <legend>Permissões (de 1 a {MAX_ROLE_PERMISSIONS})</legend>
        {PERMISSIONS.map((permission) => (
          <label className="checkbox-field" key={permission}>
            <input defaultChecked={role?.permissions.includes(permission)} name="permissions" type="checkbox" value={permission} />
            {PERMISSION_LABELS[permission]} <small>({permissionHoldersText(permission)})</small>
          </label>
        ))}
      </fieldset>
    </>
  );
}

export function RolesSection({ roles }: { roles: AccessRoleSummary[] }) {
  return (
    <section className="admin-section" aria-labelledby="roles-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Acessos e equipes</p>
          <h2 id="roles-heading">Papéis</h2>
          <p className="section-description">
            Um papel reúne permissões adicionais para atribuir de uma vez em &quot;Usuários&quot;. Cada permissão continua valendo só
            para os perfis que podem recebê-la e só no setor atual da pessoa.
          </p>
        </div>
      </div>

      <form action={createRoleAction} aria-label="Novo papel" className="create-form role-form">
        <RoleFields />
        <button type="submit">Criar papel</button>
      </form>

      {roles.length === 0 ? (
        <p>Nenhum papel cadastrado.</p>
      ) : (
        <ul className="entity-list">
          {roles.map((role) => (
            <li className="entity-item" key={role.id}>
              <div className="entity-summary">
                <strong>{role.name}</strong>
                <span className={`status-badge${role.isActive ? "" : " is-inactive"}`}>{role.isActive ? "Ativo" : "Inativo"}</span>
              </div>
              <p>{rolePermissionsText(role.permissions)}</p>
              {role.description ? <p className="section-description">{role.description}</p> : null}
              <p className="section-description">Atribuído a: {assignmentCountText(role.assignmentCount)}</p>
              <details>
                <summary>Editar</summary>
                <form action={updateRoleAction} aria-label={`Editar papel ${role.name}`} className="create-form role-form">
                  <input name="id" type="hidden" value={role.id} />
                  <RoleFields role={role} />
                  <button type="submit">Salvar papel</button>
                </form>
              </details>
              <form action={toggleRoleAction} className="entity-actions">
                <input name="id" type="hidden" value={role.id} />
                <input name="isActive" type="hidden" value={role.isActive ? "false" : "true"} />
                <button className={role.isActive ? "button-danger" : "button-secondary"} type="submit">
                  {role.isActive ? "Desativar" : "Reativar"}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
