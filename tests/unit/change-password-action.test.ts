import { beforeEach, describe, expect, it, vi } from "vitest";

const { changeOwnPassword, CurrentPasswordMismatchError } = vi.hoisted(() => ({
  changeOwnPassword: vi.fn(),
  CurrentPasswordMismatchError: class CurrentPasswordMismatchError extends Error {},
}));
vi.mock("@/modules/auth", () => ({
  changeOwnPassword,
  CurrentPasswordMismatchError,
}));

import { changeOwnPasswordAction } from "@/app/account/password/actions";
import { ValidationError } from "@/server/errors";

function formData(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("change-own-password Server Action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    changeOwnPassword.mockResolvedValue(undefined);
  });

  it("passes only the password fields to the session-bound domain operation", async () => {
    const result = await changeOwnPasswordAction(
      { status: "error", message: "" },
      formData({
        currentPassword: "current-password",
        newPassword: "new-password-12",
        confirmPassword: "new-password-12",
      }),
    );

    expect(result).toEqual({
      status: "success",
      message: "Senha alterada com sucesso.",
    });
    expect(changeOwnPassword).toHaveBeenCalledWith({
      currentPassword: "current-password",
      newPassword: "new-password-12",
      confirmPassword: "new-password-12",
    });
  });

  it("rejects a client-supplied userId without calling the domain operation", async () => {
    const result = await changeOwnPasswordAction(
      { status: "error", message: "" },
      formData({
        currentPassword: "current-password",
        newPassword: "new-password-12",
        confirmPassword: "new-password-12",
        userId: "another-user",
      }),
    );

    expect(result.status).toBe("error");
    expect(result.message).not.toContain("another-user");
    expect(changeOwnPassword).not.toHaveBeenCalled();
  });

  it("returns a clear, sanitized message when the current password is incorrect", async () => {
    changeOwnPassword.mockRejectedValueOnce(new CurrentPasswordMismatchError());

    const result = await changeOwnPasswordAction(
      { status: "error", message: "" },
      formData({
        currentPassword: "wrong-current-password",
        newPassword: "new-password-12",
        confirmPassword: "new-password-12",
      }),
    );

    expect(result).toEqual({
      status: "error",
      message: "A senha atual está incorreta.",
    });
    expect(result.message).not.toContain("wrong-current-password");
  });

  it("explains new-password validation without returning submitted values", async () => {
    changeOwnPassword.mockRejectedValueOnce(
      new ValidationError([
        { path: ["newPassword"], code: "too_small" },
      ]),
    );

    const result = await changeOwnPasswordAction(
      { status: "error", message: "" },
      formData({
        currentPassword: "current-password",
        newPassword: "short",
        confirmPassword: "short",
      }),
    );

    expect(result).toEqual({
      status: "error",
      message: "A nova senha deve ter pelo menos 12 caracteres.",
    });
    expect(result.message).not.toContain("short");
    expect(result.message).not.toContain("current-password");
  });
});
