"use client";

import { useActionState, useEffect, useRef } from "react";
import type { WebhookSecretState } from "./actions";

// Forms that show a webhook secret once (SPEC 2026-11-02-api-externa-webhooks, 5.6).

type SecretAction = (previous: WebhookSecretState, formData: FormData) => Promise<WebhookSecretState>;

const initialState: WebhookSecretState = { status: "idle", message: "" };

function SecretOnce({ state }: { state: WebhookSecretState }) {
  if (state.status === "error") {
    return (
      <p className="feedback feedback-error" role="alert">
        {state.message}
      </p>
    );
  }
  if (state.status !== "created" || !state.secret) return null;
  return (
    <div className="feedback api-token-created" role="status">
      <p>
        <strong>
          {state.message} ({state.name})
        </strong>{" "}
        Copie o segredo agora: ele não aparece de novo. O sistema que recebe usa o segredo para conferir a assinatura.
      </p>
      <label>
        Segredo
        <input className="webhook-secret-value" readOnly spellCheck={false} type="text" value={state.secret} />
      </label>
    </div>
  );
}

export function WebhookCreateForm({
  action,
  events,
  disabled,
}: {
  action: SecretAction;
  events: ReadonlyArray<{ type: string; label: string }>;
  disabled: boolean;
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "created") formRef.current?.reset();
  }, [state]);

  return (
    <>
      <SecretOnce state={state} />
      <form action={formAction} className="create-form" ref={formRef}>
        <label>
          Nome
          <input disabled={disabled} maxLength={60} name="name" required type="text" />
        </label>
        <label>
          Endereço (https)
          <input disabled={disabled} maxLength={2000} name="url" placeholder="https://sistema.exemplo.com/serviceflow" required type="url" />
        </label>
        <fieldset className="format-options" disabled={disabled}>
          <legend>Eventos</legend>
          {events.map((event) => (
            <label className="checkbox-field" key={event.type}>
              <input name="eventTypes" type="checkbox" value={event.type} />
              {event.label}
            </label>
          ))}
        </fieldset>
        <button disabled={disabled || isPending} type="submit">
          {isPending ? "Criando..." : "Criar webhook"}
        </button>
      </form>
    </>
  );
}

export function WebhookRotateForm({ action, webhookId, disabled }: { action: SecretAction; webhookId: string; disabled: boolean }) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <div>
      <form action={formAction} className="entity-actions">
        <input name="webhookId" type="hidden" value={webhookId} />
        <button className="button-secondary" disabled={disabled || isPending} type="submit">
          Gerar novo segredo
        </button>
      </form>
      <SecretOnce state={state} />
    </div>
  );
}
