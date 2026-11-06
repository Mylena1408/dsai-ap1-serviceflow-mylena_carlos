"use client";

import { startTransition, type FormEvent } from "react";

// SPEC 2026-11-06-formularios-mantem-dados: React 19 resets a form after every action passed in
// `<form action>`, refused ones included, so what the person typed disappears with the error.
// Submitting through `onSubmit` dispatches the same action state without that automatic reset;
// each form resets itself only after a successful creation. Forms keep `action={dispatch}` too:
// React skips it when `onSubmit` prevents the default, and before hydration it still posts the
// server action instead of a native GET that would put the fields in the URL.
export function keepValuesOnSubmit(dispatch: (formData: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter ?? null;
    const formData = new FormData(event.currentTarget, submitter);
    startTransition(() => dispatch(formData));
  };
}
