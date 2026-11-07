"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cancelAbsence, registerAbsence } from "@/modules/absences";
import { ApplicationError, ValidationError } from "@/server/errors";

// Managers' absences registered by the administrator (SPEC 2026-11-06-aprofundamento-configurabilidade,
// 4.3.5). The administrator names the manager; refusals come back with a fixed code.

const PAGE = "/admin?section=absences";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function errorCode(error: ApplicationError): string {
  if (error instanceof ValidationError && error.issues.some(({ path }) => path.includes("endsOn") || path.includes("startsOn"))) {
    return "absence-period";
  }
  if (error.code === "CONFLICT") return "absence-conflict";
  if (error.code === "NOT_FOUND") return "absence-missing";
  if (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN") return "absence-missing";
  return error.code === "VALIDATION_ERROR" ? "absence-invalid" : "absence-unexpected";
}

async function run(work: () => Promise<unknown>, notice: string): Promise<never> {
  try {
    await work();
  } catch (error) {
    if (error instanceof ApplicationError) redirect(`${PAGE}&absence=${errorCode(error)}`);
    throw error;
  }
  revalidatePath("/admin");
  redirect(`${PAGE}&absence=${notice}`);
}

export async function registerAbsenceByAdminAction(formData: FormData): Promise<never> {
  return run(
    () =>
      registerAbsence({
        managerId: field(formData, "managerId"),
        substituteId: field(formData, "substituteId"),
        startsOn: field(formData, "startsOn"),
        endsOn: field(formData, "endsOn"),
      }),
    "absence-registered",
  );
}

export async function cancelAbsenceByAdminAction(formData: FormData): Promise<never> {
  return run(() => cancelAbsence(field(formData, "absenceId")), "absence-cancelled");
}
