import { ConflictError, ValidationError } from "@/server/errors";

type BootstrapInputFailure =
  | "DATABASE_URL_REQUIRED"
  | "TEST_DATABASE"
  | "TERMINAL_REQUIRED"
  | "CANCELLED"
  | "PASSWORD_MISMATCH";

const INPUT_FAILURE_MESSAGES: Record<BootstrapInputFailure, string> = {
  DATABASE_URL_REQUIRED: "DATABASE_URL é obrigatória.",
  TEST_DATABASE: "Bootstrap não pode usar banco de testes.",
  TERMINAL_REQUIRED: "É necessário executar o bootstrap em um terminal interativo.",
  CANCELLED: "Bootstrap cancelado.",
  PASSWORD_MISMATCH: "A confirmação da senha não corresponde.",
};

export class BootstrapInputError extends Error {
  constructor(readonly reason: BootstrapInputFailure) {
    super(reason);
  }
}

export function formatBootstrapFailure(error: unknown): string {
  if (error instanceof ConflictError) {
    return "Bootstrap recusado: já existe um administrador.";
  }

  if (error instanceof ValidationError) {
    return "Bootstrap recusado: nome, e-mail ou senha inválidos.";
  }

  if (error instanceof BootstrapInputError) {
    return INPUT_FAILURE_MESSAGES[error.reason];
  }

  return "Falha ao criar o administrador. Verifique a configuração do banco.";
}
