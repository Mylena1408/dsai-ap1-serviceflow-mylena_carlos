import { describe, expect, it } from "vitest";
import { ConflictError, ValidationError } from "@/server/errors";
import {
  BootstrapInputError,
  formatBootstrapFailure,
} from "@/modules/auth/application/bootstrap-admin-cli";

describe("bootstrap CLI output", () => {
  it("uses fixed messages that never echo unexpected errors or credential input", () => {
    const secret = "password-that-must-not-be-logged";

    expect(
      formatBootstrapFailure(new Error(`Database failed with ${secret}`)),
    ).toBe("Falha ao criar o administrador. Verifique a configuração do banco.");
    expect(formatBootstrapFailure(new ConflictError())).toBe(
      "Bootstrap recusado: já existe um administrador.",
    );
    expect(
      formatBootstrapFailure(
        new ValidationError([{ path: ["password"], code: "custom" }]),
      ),
    ).toBe("Bootstrap recusado: nome, e-mail ou senha inválidos.");
    expect(formatBootstrapFailure(new BootstrapInputError("PASSWORD_MISMATCH"))).toBe(
      "A confirmação da senha não corresponde.",
    );
  });
});
