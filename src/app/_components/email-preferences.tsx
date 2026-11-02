import Link from "next/link";
import { NOTIFICATION_CATEGORIES, type EmailPreferences, type NotificationCategory } from "@/modules/notifications";
import { saveEmailPreferencesAction } from "./notification-actions";

// "Preferências de notificação" (SPEC 2026-11-01-notificacoes-email-preferencias, 5.1).

const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  STATUS: "Mudanças de status",
  ASSIGNMENT: "Solicitações transferidas para você",
  COMMENTS: "Comentários e notas internas",
  SLA: "Prazos próximos e vencidos",
  STAGES: "Mudanças de etapa",
  APPROVALS: "Aprovações",
};

function feedback(notice?: string): { text: string; error: boolean } | null {
  if (notice === "saved") return { text: "Preferências salvas.", error: false };
  if (notice === "invalid") return { text: "Não foi possível salvar: escolha só as categorias da lista.", error: true };
  return null;
}

type EmailPreferencesPageProps = {
  preferences: EmailPreferences;
  notificationsHref: string;
  notice?: string;
};

export function EmailPreferencesPage({ preferences, notificationsHref, notice }: EmailPreferencesPageProps) {
  const message = feedback(notice);

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Avisos</p>
          <h1>Preferências de notificação</h1>
          <p>
            Escolha o que você também quer receber por e-mail. As notificações dentro do sistema continuam sempre
            ativas.
          </p>
        </div>
        <Link className="button-link-secondary" href={notificationsHref}>
          Voltar às notificações
        </Link>
      </header>
      {message ? (
        <p className={`feedback${message.error ? " feedback-error" : ""}`} role={message.error ? "alert" : "status"}>
          {message.text}
        </p>
      ) : null}
      <form action={saveEmailPreferencesAction} className="surface-card account-form">
        <fieldset className="format-options">
          <legend>Receber por e-mail</legend>
          {NOTIFICATION_CATEGORIES.map((category) => (
            <label className="checkbox-field" key={category}>
              <input defaultChecked={preferences[category]} name="category" type="checkbox" value={category} />
              {CATEGORY_LABELS[category]}
            </label>
          ))}
        </fieldset>
        <p className="metadata">
          O e-mail traz só o aviso e o link para a solicitação; os detalhes ficam no sistema.
        </p>
        <button type="submit">Salvar preferências</button>
      </form>
    </main>
  );
}
