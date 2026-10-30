"use server";

import { changeOwnPassword, CurrentPasswordMismatchError } from "@/modules/auth";
import { AuthenticationError, ValidationError } from "@/server/errors";

export interface PasswordChangeState {
  status: "success" | "error";
  message: string;
}

function formField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function validationMessage(error: ValidationError): string {
  const paths = error.issues.flatMap((issue) => issue.path);
  if (paths.includes("currentPassword")) return "Informe sua senha atual.";
  if (paths.includes("newPassword")) return "A nova senha deve ter pelo menos 12 caracteres.";
  if (paths.includes("confirmPassword")) return "A confirmação deve ser igual à nova senha.";
  return "Confira os campos e tente novamente.";
}

export async function changeOwnPasswordAction(
  _previousState: PasswordChangeState,
  formData: FormData,
): Promise<PasswordChangeState> {
  if (formData.has("userId")) {
    return {
      status: "error",
      message: "Não foi possível alterar a senha com os dados enviados.",
    };
  }

  try {
    await changeOwnPassword({
      currentPassword: formField(formData, "currentPassword"),
      newPassword: formField(formData, "newPassword"),
      confirmPassword: formField(formData, "confirmPassword"),
    });
    return { status: "success", message: "Senha alterada com sucesso." };
  } catch (error) {
    if (error instanceof CurrentPasswordMismatchError) {
      return { status: "error", message: "A senha atual está incorreta." };
    }
    if (error instanceof ValidationError) {
      return { status: "error", message: validationMessage(error) };
    }
    if (error instanceof AuthenticationError) {
      return { status: "error", message: "Sua sessão expirou. Entre novamente." };
    }
    return {
      status: "error",
      message: "Não foi possível alterar a senha. Tente novamente.",
    };
  }
}
