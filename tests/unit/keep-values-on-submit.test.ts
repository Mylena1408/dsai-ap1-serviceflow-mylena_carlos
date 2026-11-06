import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormEvent } from "react";
import { keepValuesOnSubmit } from "@/app/_components/keep-values-on-submit";

// SPEC 2026-11-06-formularios-mantem-dados, section 6 (SF-158): the submission goes through the
// action state without the native form action, which is what makes React reset the form.

class FakeFormData {
  constructor(
    readonly form: unknown,
    readonly submitter: unknown,
  ) {}
}

afterEach(() => vi.unstubAllGlobals());

describe("keepValuesOnSubmit", () => {
  it("prevents the native submission and dispatches the form data, with the submitter", () => {
    vi.stubGlobal("FormData", FakeFormData);
    const dispatch = vi.fn();
    const form = { id: "form" };
    const submitter = { id: "button" };
    const preventDefault = vi.fn();

    keepValuesOnSubmit(dispatch)({
      preventDefault,
      currentTarget: form,
      nativeEvent: { submitter },
    } as unknown as FormEvent<HTMLFormElement>);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledOnce();
    const sent = dispatch.mock.calls[0]![0] as FakeFormData;
    expect(sent).toBeInstanceOf(FakeFormData);
    expect(sent.form).toBe(form);
    expect(sent.submitter).toBe(submitter);
  });

  it("works when the browser gives no submitter", () => {
    vi.stubGlobal("FormData", FakeFormData);
    const dispatch = vi.fn();

    keepValuesOnSubmit(dispatch)({
      preventDefault: vi.fn(),
      currentTarget: {},
      nativeEvent: {},
    } as unknown as FormEvent<HTMLFormElement>);

    expect((dispatch.mock.calls[0]![0] as FakeFormData).submitter).toBeNull();
  });
});
