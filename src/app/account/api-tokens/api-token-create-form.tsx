"use client";

import { useActionState, useEffect, useRef } from "react";
import type { ApiTokenCreationState } from "./actions";
import { keepValuesOnSubmit } from "@/app/_components/keep-values-on-submit";

// Creation of a personal token (SPEC 2026-11-02-api-externa-webhooks, 5.1): the value appears once.

type CreateAction = (previous: ApiTokenCreationState, formData: FormData) => Promise<ApiTokenCreationState>;

const initialState: ApiTokenCreationState = { status: "idle", message: "" };

export function ApiTokenCreateForm({ action }: { action: CreateAction }) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "created") formRef.current?.reset();
  }, [state]);

  return (
    <>
      {state.status === "created" && state.value ? (
        <div className="feedback api-token-created" role="status">
          <p>
            <strong>Token &quot;{state.name}&quot; criado.</strong> Copie agora: ele não aparece de novo.
          </p>
          <label>
            Token
            <input className="api-token-value" readOnly spellCheck={false} type="text" value={state.value} />
          </label>
        </div>
      ) : null}
      {state.status === "error" ? (
        <p className="feedback feedback-error" role="alert">
          {state.message}
        </p>
      ) : null}
      <form action={formAction} onSubmit={keepValuesOnSubmit(formAction)} className="account-form" ref={formRef}>
        <label>
          Nome
          <input maxLength={60} name="name" placeholder="Ex.: Integração do portal" required type="text" />
        </label>
        <label>
          Escopo
          <select defaultValue="READ" name="scope">
            <option value="READ">Somente leitura</option>
            <option value="WRITE">Leitura e escrita</option>
          </select>
        </label>
        <label>
          Validade
          <select defaultValue="90" name="validityDays">
            <option value="30">30 dias</option>
            <option value="90">90 dias</option>
            <option value="365">365 dias</option>
          </select>
        </label>
        <button disabled={isPending} type="submit">
          {isPending ? "Criando..." : "Criar token"}
        </button>
      </form>
    </>
  );
}
