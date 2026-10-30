import type { SectorRecord } from "@/modules/sectors";
import type { ManagedUser } from "@/modules/users";
import { AdminCreateForm } from "../../create-form";
import { AdminRecordEditor } from "../../record-editor";
import { createUserAction, toggleUserAction, updateUserAction } from "./actions";

type UsersSectionProps = {
  section: "users";
  users: ManagedUser[];
  sectors: SectorRecord[];
};

export function UsersSection({ section, users, sectors }: UsersSectionProps) {
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
            </select>
          </label>
          <label>
            Setor da equipe
            <select name="sectorId" defaultValue="">
              <option value="">Selecione se for atendente</option>
              {sectors
                .filter((sector) => sector.isActive)
                .map((sector) => (
                  <option key={sector.id} value={sector.id}>{sector.name}</option>
                ))}
            </select>
            </label>
        </AdminCreateForm>
        <ul className="entity-list">
          {users.map((user) => (
            <AdminRecordEditor
              key={user.id}
              record={{ kind: "user", ...user }}
              sectors={sectors}
              section={section}
              toggleAction={toggleUserAction}
              updateAction={updateUserAction}
            />
          ))}
        </ul>
        </section>
  );
}
