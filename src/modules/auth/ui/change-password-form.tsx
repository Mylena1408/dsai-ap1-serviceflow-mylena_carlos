"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";

export interface PasswordChangeState {
  status: "success" | "error";
  message: string;
}

export type PasswordChangeAction = (
  previousState: PasswordChangeState,
  formData: FormData,
) => Promise<PasswordChangeState>;

const initialState: PasswordChangeState = {
  status: "error",
  message: "",
};

export function ChangePasswordForm({
  action,
  cancelHref,
}: {
  action: PasswordChangeAction;
  cancelHref: string;
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form action={formAction} className="account-form" ref={formRef}>
      <label>
        Senha atual
        <input
          autoComplete="current-password"
          name="currentPassword"
          required
          type="password"
        />
      </label>
      <label>
        Nova senha
        <input
          autoComplete="new-password"
          minLength={12}
          name="newPassword"
          required
          type="password"
        />
      </label>
      <label>
        Confirmar nova senha
        <input
          autoComplete="new-password"
          minLength={12}
          name="confirmPassword"
          required
          type="password"
        />
      </label>
      {state.message ? (
        <p
          aria-live="polite"
          className={`feedback${state.status === "error" ? " feedback-error" : ""}`}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
      ) : null}
      <div className="editor-actions">
        <button className="editor-save-button" disabled={isPending} type="submit">
          {isPending ? "Salvando..." : "Salvar"}
        </button>
        <button
          className="button-secondary"
          onClick={() => router.push(cancelHref)}
          type="button"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
