import { ROLE_LABELS } from "@/shared/admin-labels";
import type { ManagedUser } from "@/modules/users";

// Anonymization of one person (SPEC 2026-11-02-auditoria-lgpd, 5.5). The form appears only for
// deactivated people; the server checks every condition of 5.5.1 again.

type RedirectAction = (formData: FormData) => Promise<never>;

export function UserAnonymizationPanel({ user, action }: { user: ManagedUser; action: RedirectAction }) {
  if (user.isActive || user.anonymizedAt) {
    return null;
  }

  return (
    <section aria-label="Anonimização" className="requirements-panel">
      <h3>Anonimização</h3>
      <p className="section-description">
        Troca o nome e o e-mail, remove os textos escritos pela pessoa, os anexos que ela enviou, as preferências e as
        notificações. As solicitações e o histórico continuam. A ação é irreversível.
      </p>
      <form action={action} className="entity-actions">
        <input name="userId" type="hidden" value={user.id} />
        <input name="section" type="hidden" value="users" />
        <label className="checkbox-field">
          <input name="confirmed" required type="checkbox" value="true" />
          Entendo que a anonimização de {user.name} é irreversível
        </label>
        <button className="button-danger" type="submit">
          Anonimizar
        </button>
      </form>
    </section>
  );
}

/** An anonymized person is shown read-only: no editing, reactivation or permissions (5.5.2). */
export function AnonymizedUserItem({ user }: { user: ManagedUser }) {
  return (
    <li className="entity-item">
      <div className="entity-record-content">
        <div className="entity-summary">
          <strong>{user.name}</strong>
          <span className="status-badge is-inactive">Anonimizado</span>
        </div>
        <div className="entity-details">
          <span>{ROLE_LABELS[user.role]}</span>
          {user.anonymizedAt ? (
            <span>
              Anonimizado em{" "}
              <time dateTime={user.anonymizedAt.toISOString()}>{user.anonymizedAt.toLocaleString("pt-BR")}</time>
            </span>
          ) : null}
        </div>
      </div>
    </li>
  );
}
