"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import type { AdminUpdateState } from "./actions";
import { keepValuesOnSubmit } from "@/app/_components/keep-values-on-submit";

type CreateAction = (
  previousState: AdminUpdateState,
  formData: FormData,
) => Promise<AdminUpdateState>;

type AdminCreateFormProps = {
  action: CreateAction;
  children: ReactNode;
  submitLabel: string;
};

const initialState: AdminUpdateState = {
  status: "error",
  message: "",
};

export function AdminCreateForm({
  action,
  children,
  submitLabel,
}: AdminCreateFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      router.refresh();
    }
  }, [router, state]);

  return (
    <form action={formAction} onSubmit={keepValuesOnSubmit(formAction)} className="create-form" ref={formRef}>
      {children}
      <button disabled={isPending} type="submit">
        {isPending ? "Criando..." : submitLabel}
      </button>
      {state.message ? (
        <p
          aria-live="polite"
          className={`feedback${state.status === "error" ? " feedback-error" : ""}`}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
