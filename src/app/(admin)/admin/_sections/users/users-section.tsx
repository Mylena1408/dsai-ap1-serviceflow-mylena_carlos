import type { SectorRecord } from "@/modules/sectors";
import type { ManagedUser } from "@/modules/users";
import type { AccessRoleOverview, PermissionOverview } from "@/modules/permissions";
import { UserPermissionsPanel } from "../../user-permissions-panel";
import { UserRolesPanel } from "../../user-roles-panel";
import { AnonymizedUserItem, UserAnonymizationPanel } from "../../user-anonymization-panel";
import { AdminCreateForm } from "../../create-form";
import { AdminRecordEditor } from "../../record-editor";
import {
  anonymizeUserAction,
  assignRoleAction,
  createUserAction,
  grantPermissionAction,
  removeRoleAction,
  revokePermissionAction,
  toggleUserAction,
  updateUserAction,
} from "./actions";

type UsersSectionProps = {
  section: "users";
  users: ManagedUser[];
  sectors: SectorRecord[];
  permissions: PermissionOverview;
  /** SPEC 2026-11-06-aprofundamento-configurabilidade, 6.3. */
  roles: AccessRoleOverview;
};

export function UsersSection({ section, users, sectors, permissions, roles }: UsersSectionProps) {
  return (
    <section className="admin-section" aria-labelledby="users-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Acessos e equipes</p>
            <h2 id="users-heading">Usuários</h2>
            <p className="section-description">Gerencie perfis, acessos e a associação de atendentes aos setores.</p>
          </div>
        </div>
        <AdminCreateForm action={createUserAction} submitLabel="Criar usuário">
          <label>Nome<input name="name" required /></label>
          <label>E-mail<input name="email" type="email" required /></label>
          <label>Senha inicial<input name="password" type="password" required /></label>
          <label>
            Perfil
            <select name="role" defaultValue="REQUESTER" required>
              <option value="ADMIN">Administrador</option>
              <option value="REQUESTER">Solicitante</option>
              <option value="ATTENDANT">Atendente</option>
              <option value="MANAGER">Gestor</option>
            </select>
          </label>
          <label>
            Setor da equipe
            <select name="sectorId" defaultValue="">
              <option value="">Selecione se for atendente ou gestor</option>
              {sectors
                .filter((sector) => sector.isActive)
                .map((sector) => (
                  <option key={sector.id} value={sector.id}>{sector.name}</option>
                ))}
            </select>
            </label>
        </AdminCreateForm>
        <ul className="entity-list">
          {users.map((user) =>
            user.anonymizedAt ? (
              <AnonymizedUserItem key={user.id} user={user} />
            ) : (
            <AdminRecordEditor
              key={user.id}
              record={{ kind: "user", ...user }}
              sectors={sectors}
              section={section}
              toggleAction={toggleUserAction}
              updateAction={updateUserAction}
            >
              <UserPermissionsPanel
                grantAction={grantPermissionAction}
                grants={permissions.grants.filter((grant) => grant.userId === user.id)}
                history={permissions.events.filter((event) => event.userId === user.id).slice(0, 10)}
                revokeAction={revokePermissionAction}
                today={permissions.today}
                user={user}
              />
              <UserRolesPanel
                assignAction={assignRoleAction}
                assignments={roles.assignments.filter((assignment) => assignment.userId === user.id)}
                history={roles.events.filter((event) => event.userId === user.id).slice(0, 10)}
                removeAction={removeRoleAction}
                roles={roles.roles}
                today={roles.today}
                user={user}
              />
              <UserAnonymizationPanel action={anonymizeUserAction} user={user} />
            </AdminRecordEditor>
            ),
          )}
        </ul>
        </section>
  );
}
