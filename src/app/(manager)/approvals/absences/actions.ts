"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cancelAbsence, registerAbsence } from "@/modules/absences";
import { ApplicationError, ValidationError } from "@/server/errors";

// Absences of the manager (SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.5). Refusals go
// back with a fixed code; the typed dates never travel in the address.

const PAGE = "/approvals/absences";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function errorCode(error: ApplicationError): string {
  if (error instanceof ValidationError && error.issues.some(({ path }) => path.includes("endsOn") || path.includes("startsOn"))) {
    return "period";
  }
  if (error.code === "CONFLICT") return "conflict";
  if (error.code === "NOT_FOUND" || error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN") return "missing";
  return error.code === "VALIDATION_ERROR" ? "validation" : "unexpected";
}

async function run(work: () => Promise<unknown>, notice: string): Promise<never> {
  try {
    await work();
  } catch (error) {
    if (error instanceof ApplicationError) redirect(`${PAGE}?error=${errorCode(error)}`);
    throw error;
  }
  revalidatePath(PAGE);
  revalidatePath("/approvals");
  redirect(`${PAGE}?notice=${notice}`);
}

export async function registerAbsenceAction(formData: FormData): Promise<never> {
  return run(
    () =>
      registerAbsence({
        substituteId: field(formData, "substituteId"),
        startsOn: field(formData, "startsOn"),
        endsOn: field(formData, "endsOn"),
      }),
    "registered",
  );
}

export async function cancelAbsenceAction(formData: FormData): Promise<never> {
  return run(() => cancelAbsence(field(formData, "absenceId")), "cancelled");
}
